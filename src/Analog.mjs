//!
//!
//!
//! ## Available config
//! - `app.name` app name, defaults to `analog`.
//! - `app.version` app version, defaults to `0`.
//!
//! - `app.static` if true, acitvates static file server
//! - `app.static.path` path to static files, defaults to `$CWD/static`.
//! - `app.static.pattern` regexp pattern for static, defaults to
//!                        `\\\/static\\\/(.+)$`
//! - `app.static.cachecontrol` enables cache control for static files.
//!
//! - `http.server` server name, defaults to "`app.name`/`app.version`"
//! - `http.port` http port to listen to, defaults to `9110`
//! - `http.nodate` do not include current date in responses
//! - `http.jsonerrors` send errors as JSON, defaults to 'falsly`.
//! - `http.senderrors` send Unhandled errors to client.
//!
//! - `analog.configdir` path to config, default to `$CWD`
//!
//! - `json.prettify` prettify json responses with 4 spaces.
//!

import {Runtime} from "//silo.tools/";

import {Dict} from "//es.parts/ess/0.0.1/";
import {List} from "//es.parts/ess/0.0.1/";
import {Mime} from "//es.parts/ess/0.0.1/";
import {Str} from "//es.parts/ess/0.0.1/";
import {Url} from "//es.parts/ess/0.0.1/";
import {Path} from "//es.parts/ess/0.0.1/";
import {QueryString} from "//es.parts/ess/0.0.1/";

import {Fs} from "//es.parts/isoio/0.0.1/";
import {Http} from "//es.parts/isoio/0.0.1/";
import {Process} from "//es.parts/isoio/0.0.1/";

export const HOOK_STARTUP = "analog.startup";
export const HOOK_REQUEST = "http.request";
export const HOOK_RESPONSE = "http.response";
export const HOOK_RESPOND = "http.respond";
export const HOOK_LISTEN = "http.listen";
export const HOOK_REQUESTERROR = "http.error";
export const HOOK_ERROR = "analog.error";

export {init};
export {start};
export {shutdown};
export {cwd};
export {env};
export {route};
export {hook};
export {setup};
export {log};
export {datelog};
export {verbose};
export {warning};
export {error};
export {trigger};
export {config};
export {configAsPath};
export {configIsTruthy};
export {get};
export {set};
export {setRenderer};

export {file};

export {render};

export {redirect};

export {reject};

export {created};
export {methodNotAllowed};
export {notFound};
export {unauthorized};
export {badRequest};

export {cacheControl};

const DEFAULT_NAME = "analog";
const DEFAULT_VERSION = 0;
const DEFAULT_HTTP_PORT = 9110;

const FLAG_NODATE       = 0x01 << 0;
const FLAG_NOOUTPUT     = 0x01 << 1;

class Request {
    constructor(request, url, params) {
        this._date = new Date();
        this._request = request;
        this._url = url;
        this._params = params;
        this._userdata = Dict.create();
        this._afterCallbacks = null;
    }

    header(name) {
        return this._request.headers.get(Str.lower(name));
    }

    method(method=null) {
        if (method === null) {
            return this._request.method;
        }

        return this._request.method === method;
    }

    url() {
        return this._url;
    }

    params(key) {
        if (key === null || key === void(0)) {
            return this._params;
        }

        return this._params[String(key)];
    }

    accepts(encoding) {
        const all = this._request.headers.getAll("accept");
        return List.some(all, enc => enc === encoding || enc === "*/*");
    }

    query(key=null) {
        if (!this._query) {
            if (this._url.search) {
                this._query = QueryString.decode(this._url.search.substr(1));
            }
        }

        if (key) {
            if (this._query) {
                return this._query[key] || null;
            }
            return null;
        }

        return this._query || Object.create(null);
    }

    get(key) {
        return this._userdata[key] || null;
    }

    set(key, value) {
        this._userdata[key] = value;
    }

    after(callback) {
        this._afterCallbacks = List.append(this._afterCallbacks || [], callback);
        return this;
    }

    json() {
        return this._request.json();
    }

    text() {
        return this._request.text();
    }
}

class Response {
    constructor(status=200) {
        this.status = status;
        this.headers = new Http.Headers;
        this.body = null;
        this.request = null;
    }

    header(name) {
        return this.headers.has(name);
    }

    setHeader(name, value) {
        this.headers.set(name, value);
    }
}

class ErrorResponse extends Response {
    constructor(status=400, message=null) {
        super(status);
        this.body = message || Http.statusCodeToText(status);
        this.error = null;
    }
}

class FileResponse extends Response {
    constructor() {
        super();
    }
}

const State = Runtime.state("analog/1", state => initState(state || {}));

/// Initialize Analog without starting the underlying web server.
function init(configPathOrConfig=null) {
    if (State.initialized) {
        return Promise.reject(new Error("Already started"));
    }

    if (configPathOrConfig !== null && typeof configPathOrConfig === "object") {
        const config = Dict.clone(configPathOrConfig);
        config["analog.configdir"] = cwd();
        return internalInit(config);
    }

    const path = Path.resolve(cwd(), configPathOrConfig || "./config.json");

    return readExternalConfig(path)
        .then(internalInit);
}

/// Initialize and starts the underlying web server
function start(configPathOrConfig=null) {
    if (State.initialized) {
        return internalStart();
    }

    return init(configPathOrConfig).then(internalStart(configPathOrConfig));
}

function shutdown() {
    return Http.close(State)
        .catch(_ => {
        })
        .then(() => {
            initState(State);
        });
}

/// Returns current working directory of the application
function cwd() {
    return Process.cwd();
}

/// Returns a dict with environment variables passed to the application
function env() {
    return Process.env();
}

/// Add an application route.
///
/// Expected either a Regular Expression or a pattern.
///
/// ## Examples
/// ```
/// Analog.route("/users/:username/", handleUser);
/// Analog.route(/\/static\/(.+)$/. handleStaticFile);
/// ```
function route(expression, callback) {
    if (expression instanceof RegExp) {
        State.handlers.push({expression, re: expression, keys: null, callback});
        return;
    }

    const {re, keys} = compile(expression);
    State.handlers.push({expression, re, keys, callback});
}

/// Add a global application hook
///
/// The hook is then triggered by Analog itself or a third party service.
function hook(name, callback) {
    State.hooks[name] = List.append(State.hooks[name] || [], callback);
}

/// Calls callback on STARTUP.
///
/// Shortcut for `Analog.hook(Analog.HOOK_STARTUP, callback);`.
function setup(callback) {
    hook(HOOK_STARTUP, callback);
}

function log(msg, service=State.name) {
    console.log(`${service}: ${msg}`);
}

function datelog(msg, service=State.name) {
    if (isset(FLAG_NOOUTPUT)) {
        return;
    }

    const d = new Date;
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    console.log(`[${date} ${time}] (${service}) ${msg}`);
}

function verbose(msg, service=State.name) {
    console.log(`${service}: ${msg}`);
}

function warning(msg, service=State.name) {
    console.log(`${service}: WARNING ${msg}`);
}

function error(msg, service=State.name) {
    console.error(`${service}: ERROR ${msg}`);
}

/// Trigger a system-wide hook
///
/// ## Examples
/// ```
/// Analog.hook("my.application.hook", () => Analog.log("hook triggered"));
/// Analog.trigger("my.application.hook");
/// ```
function trigger(name, params=null) {
    const callbacks = State.hooks[name];

    if (!callbacks || List.empty(callbacks)) {
        return Promise.resolve();
    }

    return callPromiseChain(callbacks, 0, params);
}

/// Get application configuration
///
/// ## Examples
/// ```
/// Analog.config();
/// // {}
///
/// Analog.config("app.name");
/// // "analog"
///
/// Analog.config("nonexistingconfig.key", "value");
/// // "value"
///
/// ```
function config(key=null, alt=null) {
    if (key === null) {
        return Dict.clone(State.config);
    }

    return key in State.config ? State.config[key] : alt;
}

/// Get the truthy value of a config key
///
/// ## Examples
/// ```
/// Analog.configIsTruthy("nonexistingconfig.key");
/// // false
///
/// Analog.configIsTruthy("app.name");
/// // true
/// ```
function configIsTruthy(key) {
    if (key in State.config === false) {
        return false;
    }

    const value = State.config[key];

    if (typeof value === "boolean") {
        return value;
    } else if (typeof value === "number") {
        return !!value;
    } else if (typeof value === "string") {
        const str = Str.lower(value);
        return str === "true" || str === "1" || str === "yes";
    }

    return value !== null;
}

function configAsPath(key, alt=null) {
    if (key in State.config) {
        return Path.resolve(State.config["analog.configdir"], State.config[key]);
    }

    if (alt !== null) {
        return Path.resolve(State.config["analog.configdir"], alt);
    }

    return null;
}

function get(key, alt=null) {
    return key in State.kvstore ? State.kvstore[key] : alt;
}

function set(key, value=null) {
    if (value === null) {
        delete State.kvstore[key];
    }

    State.kvstore[key] = value;
}

function setRenderer(callback) {
    State.renderCallback = callback;
}

function file(path, mime=null) {
    return Fs.size(path)
        .then(size => {
            const response = new FileResponse;
            response.setHeader("content-type", mime || Mime.lookupPath(path));
            response.setHeader("content-length", size);
            response.body = Fs.readable(path);
            return response;
        })
        .catch(error => {
            if (error.code === Fs.ERR_NOT_FOUND) {
                return notFound();
            }

            throw error;
        });
}

function render(template, context) {
    const dirpath = configAsPath("app.templates.path", "templates");
    const path = Path.join(dirpath, template);

    if (State.renderCallback === null) {
        return file(path);
    }

    let promise;

    try {
        const result = State.renderCallback(path, context);

        if (result instanceof Promise) {
            promise = result;
        } else {
            promise = Promise.resolve(result);
        }
    } catch (error) {
        promise = Promise.reject(error);
    }

    return promise;
}

function redirect(location) {
    const response = new Response(Http.FOUND);
    response.headers.set("location", location);
    return response;
}

function created(location) {
    const response = new Response(Http.CREATED);
    response.setHeader("location", location);
    return response;
}

function methodNotAllowed(object=null) {
    return reject(Http.METHOD_NOT_ALLOWED, object);
}

function notFound(object=null) {
    return reject(Http.NOT_FOUND, object);
}

function unauthorized(object=null) {
    return reject(Http.UNAUTHORIZED, object);
}

function badRequest(object=null) {
    return reject(Http.BAD_REQUEST, object);
}

function reject(status=Http.INTERNAL_SERVER_ERROR, object=null) {
    return new ErrorResponse(status, object);
}

function cacheControl(value, response) {
    return request => {
        request.after(response => {
            if (response.status === 200 &&
                response.headers.has("cache-control") === false) {
                response.setHeader("cache-control", value);
            }
        });

        return response;
    };
}

// Callbacks

function initState(state) {
    state.name = "analog";
    state.flags = 0;
    state.version = 0;
    state.servername = null;
    state.initialized = false;
    state.jsontabs =  0;
    state.handlers = [];
    state.hooks = Dict.create();
    state.config = Dict.create();
    state.renderCallback = null;
    state.kvstore =  Dict.create();
    return state;
}

function internalInit(config) {
    State.config = config;
    State.name = config["app.name"] || DEFAULT_NAME;
    State.version = config["app.version"] || DEFAULT_VERSION;
    State.servername = config["http.server"] || `${State.name}/${State.version}`;
    State.jsontabs = configIsTruthy("json.prettify") ? 4 : 0;

    maybeset(FLAG_NODATE, configIsTruthy("http.nodate"));
    maybeset(FLAG_NOOUTPUT, configIsTruthy("logging.disabled"));

    hook(HOOK_STARTUP, handleStartupHook);

    return trigger(HOOK_STARTUP);
}

function internalStart() {
    hook(HOOK_RESPOND, handleRespondHook);
    hook(HOOK_LISTEN, handleListenHook);

    let port = parseInt(State.config["http.port"], 10);

    const httpOptions = {
        port: isNaN(port) ? DEFAULT_HTTP_PORT : port,
        requestHandler: handleRequest,
    };

    return Http.listen(httpOptions, State)
        .then(info => trigger(HOOK_LISTEN, info));
}

function handleRequest(context, httpRequest) {
    let url, initialError;

    try {
        url = Url.parse(httpRequest.url);
    } catch(error) {
        url = Url.parse("/");
        initialError = error;
    }

    const {callback, params} = findRoute(url.pathname);
    const request = new Request(httpRequest, url, params);

    return routeRequest(request, callback, initialError)
        .catch(error => {
            if (error instanceof Response) {
                return makeResponse(error.request || request, error);
            }

            return trigger(HOOK_REQUESTERROR, error)
                .catch(innerError =>
                    makeErrorResponse(request, error, innerError))
                .then(result => {
                    if (result instanceof Response) {
                        return result;
                    }
                    return makeErrorResponse(request, error);
                });
        })
        .then(response => respond(httpRequest, response))
        .catch(error => {
            if (HOOK_ERROR in State.hooks === false) {
                throw error;
            }

            return trigger(HOOK_ERROR, error);
        })
        .catch(error => handleUnhandledError(httpRequest, error));
}

function handleStartupHook() {
    if (configIsTruthy("app.static")) {
        const basepath = configAsPath("app.static.path", "static");
        const pattern = config("app.static.pattern", "\\\/static\\\/(.+)$");
        const cachecontrol = configIsTruthy("app.static.cachecontrol");

        route(new RegExp(pattern), request => {
            const response = file(Path.join(basepath, request.params(0)));
            if (cachecontrol) {
                return cacheControl({public: 1, maxAge: 259200}, response);
            }
            return response;
        });
    }

    if (configIsTruthy("http.jsonerrors")) {
        hook(HOOK_RESPONSE, jsonErrorsMiddleware);
    }
}

function handleRespondHook(response) {
    const r = response.request;
    datelog(`"${r.method()} ${r.url().href}" ${response.status}`);
}

function handleListenHook(info) {
    datelog(`Listening for connection on port ${info.port}`);
}

function handleUnhandledError(httpRequest, error) {
    const message = error.stack
                 || error.message
                 || "Unknown error";

    const text = `${Str.repeat("=", 15)} UNHANDLED ERROR ${Str.repeat("=", 15)}\n`
               + `${message}\n`
               + `${Str.repeat("=", 47)}\n`;

    console.error(text);

    try {
        const body = configIsTruthy("http.senderrors") ? text
                                                       : "Internal Server Error";
        return httpRequest.respond(new ErrorResponse(500, body))
            .catch(error2 => console.error(error2));
    } catch(error) {
        console.error(error);
    }
}

// Internals

function isset(flag) {
    return (flag & State.flags) === flag;
}

function maybeset(flag, truthy) {
    if (truthy) {
        State.flags |= flag;
    }
}

function readExternalConfig(path) {
    return Fs.read(path)
        .then(result =>  result.json())
        .then(config => {
            if ("analog.configdir" in config === false) {
                config["analog.configdir"] = Path.dirname(path);
            }

            return config;
        })
        .catch(() => {
            warning(`Unable to read config form ${path}`);
            return Dict.create();
        });
}

function respond(request, response) {
    return trigger(HOOK_RESPOND, response)
        .then(() => request.respond(response));
}

function routeRequest(request, callback, initialError) {
    if (initialError) {
        return Promise.reject(initialError);
    }

    return trigger(HOOK_REQUEST, request)
        .then(value => {
            if (value) {
                return makeResponse(request, value);
            } else {
                if (!callback) {
                    return makeResponse(request, notFound());
                }

                return callCallbackChain(callback, request)
                    .then(value => makeResponse(request, value));
            }
        });
}

function callCallbackChain(value, params) {
    if (typeof value === "function") {
        try {
            const result = value(params);

            if (result instanceof Promise) {
                return result
                    .then(inner => callCallbackChain(inner, params));
            }

            return callCallbackChain(result, params);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    return Promise.resolve(value);
}

function callPromiseChain(callbacks, idx, params, arg=void(0)) {
    if (idx === List.len(callbacks)) {
        return Promise.resolve(arg);
    }

    const callback = callbacks[idx];

    let promise;

    try {
        const result = callback(params);

        if (result instanceof Promise) {
            promise = result;
        } else {
            promise = Promise.resolve(result);
        }
    } catch (error) {
        return Promise.reject(error);
    }

    return promise.then(arg2 =>
            callPromiseChain(callbacks, idx + 1, params, arg2 || arg));
}

function makeErrorResponse(request, error, _outerError) {
    const response = reject(Http.INTERNAL_SERVER_ERROR);
    response.error = error instanceof Error ? error : null;
    return makeResponse(request, response);
}

function makeResponse(request, value) {
    let response;

    if (value instanceof Response) {
        response = value;
    } else {
        response = new Response;
        response.body = value;
    }

    response.request = request;

    if (response.body === void(0)) {
        response.setHeader("content-type", "text/plain");
        response.body = Http.statusCodeToText(response.status);
    } else if (response.status === Http.OK && response.body === null) {
        response.status = Http.NO_CONTENT;
    }

    if (request._afterCallbacks) {
        return callPromiseChain(request._afterCallbacks, 0, response)
            .then(() => trigger(HOOK_RESPONSE, response))
            .then(() => finalizeResponse(response));
    } else {

        return trigger(HOOK_RESPONSE, response)
            .then(() => finalizeResponse(response));
    }
}

function finalizeResponse(response) {
    if (response.headers.has("server") === false) {
        response.setHeader("server", State.servername);
    }

    if (response.headers.has("date") === false && isset(FLAG_NODATE) === false) {
        response.setHeader("date", (new Date).toUTCString());
    }

    if (response.headers.has("content-type") === false &&
        response.body !== null) {

        // TODO: Add support for Streams

        if (typeof response.body === "string") {
            response.setHeader("content-type", "text/html");
        } else if (typeof response.body === "object") {
            response.body = JSON.stringify(response.body, null, State.jsontabs);
            response.setHeader("content-type", "application/json")
            response.setHeader("content-length", Str.bytelen(response.body));
        } else {
            response.setHeader("content-type", "text/plain");
            response.body = Http.statusCodeToText(response.status);
        }
    }

    return response;
}

function findRoute(path) {
    const handlers = State.handlers;

    for (let handler of handlers) {
        const match = handler.re.exec(path);
        handler.re.lastIndex = 0;

        if (!match) {
            continue;
        }

        const callback = handler.callback;
        const params = Object.create(null);

        if (handler.keys === null) {
            if (match.length > 1) {
                List.each(List.slice(match, 1), (v, idx) => params[idx] = v);
            }
        } else {
            List.each(handler.keys, (key, idx) => params[key] = match[idx + 1]);
        }

        return {callback, params};
    }

    return { callback: null, params: null };
}

function compile(path) {
    let source = path.replace(/\//g, "\\/");

    let keys = [];

    const paramsMatch = source.match(/(:[a-zA-Z]+)/g);

    if (paramsMatch) {
        const len = paramsMatch.length;
        for (let i = 0; i < len; i++) {
            const key = paramsMatch[i];
            keys.push(key.substr(1));
            source = source.replace(key, "([A-Za-z0-9_%\.\'\@\-]+)");
        }
    }

    const re = new RegExp(`^${source}$`, "g");

    return {re, keys};
}

function jsonErrorsMiddleware(response) {
    if (response instanceof ErrorResponse === false) {
        return;
    }

    if (response.request.accepts("application/json")) {
        let code, message;

        if (response.error instanceof Error) {
            code = response.error.code || response.status;
            message = response.error.message;
        } else if (typeof response.error === "string") {
            code = response.status;
            message = response.error;
        } else {
            code = response.status;
            message = String(response.body);
        }

        response.body = { error: { code, message } };

    } else if (response.error !== null && typeof response.error === "object") {
        response.body = response.error.stack
                     || response.error.message
                     || Http.statusCodeToText(response.code);
    }
}

function pad(n) {
    return n < 10 ? `0${n}` : String(n);
}
