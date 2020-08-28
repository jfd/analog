//!
//!
//!
//! ## Available config
//! - `app.name` app name, defaults to `analog`.
//! - `app.version` app version, defaults to `0`.
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
import Http from "http";
import Url from "url";
import QueryString from "querystring";

import {Dict} from "//es.parts/ess/0.0.1/";
import {List} from "//es.parts/ess/0.0.1/";
import {Str} from "//es.parts/ess/0.0.1/";
import {Path} from "//es.parts/ess/0.0.1/";

export const HOOK_STARTUP = "analog.startup";
export const HOOK_REQUEST = "http.request";
export const HOOK_RESPONSE = "http.response";
export const HOOK_RESPOND = "http.respond";
export const HOOK_LISTEN = "http.listen";
export const HOOK_REQUESTERROR = "http.error";
export const HOOK_ERROR = "analog.error";

export const STATUS_OK = 200;
export const STATUS_CREATED = 201;
export const STATUS_ACCEPTED = 202;
export const STATUS_NON_AUTHORITATIVE_INFORMATION = 203;
export const STATUS_NO_CONTENT = 204;
export const STATUS_RESET_CONTENT = 205;
export const STATUS_PARTIAL_CONTENT = 206;
export const STATUS_MULTI_STATUS = 207;
export const STATUS_ALREADY_REPORTED = 208;
export const STATUS_IM_USED = 209;
export const STATUS_MULTIPLE_CHOICES = 300;
export const STATUS_MOVED_PERMANENTLY = 301;
export const STATUS_FOUND = 302;
export const STATUS_SEE_OTHER = 303;
export const STATUS_NOT_MODIFIED = 304;
export const STATUS_USE_PROXY = 305;
export const STATUS_SWITCH_PROXY = 306;
export const STATUS_TEMPORARY_REDIRECT = 307;
export const STATUS_PERMANENT_REDIRECT = 308;
export const STATUS_BAD_REQUEST = 400;
export const STATUS_UNAUTHORIZED = 401;
export const STATUS_PAYMENT_REQUIRED = 402;
export const STATUS_FORBIDDEN = 403;
export const STATUS_NOT_FOUND = 404;
export const STATUS_METHOD_NOT_ALLOWED = 405;
export const STATUS_NOT_ACCEPTABLE = 406;
export const STATUS_PROXY_AUTHENTICATION_REQUIRED = 407;
export const STATUS_REQUEST_TIME_OUT = 408;
export const STATUS_CONFLICT = 409;
export const STATUS_GONE = 410;
export const STATUS_LENGTH_REQUIRED = 411;
export const STATUS_PRECONDITION_FAILED = 412;
export const STATUS_PAYLOAD_TOO_LARGE = 413;
export const STATUS_URI_TOO_LONG = 414;
export const STATUS_UNSUPPORTED_MEDIA_TYPE = 415;
export const STATUS_RANGE_NOT_SATISFIABLE = 416;
export const STATUS_EXPECTATION_FAILED = 417;
export const STATUS_IM_A_TEAPOT = 418;
export const STATUS_MISDIRECTED_REQUEST = 421;
export const STATUS_UNPROCESSABLE_ENTITY = 422;
export const STATUS_LOCKED = 423;
export const STATUS_FAILED_DEPENDENCY = 424;
export const STATUS_UPGRADE_REQUIRED = 426;
export const STATUS_PRECONDITION_REQUIRED = 428;
export const STATUS_TOO_MANY_REQUESTS = 429;
export const STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE = 431;
export const STATUS_UNAVAILABLE_FOR_LEGAL_REASONS = 451;
export const STATUS_INTERNAL_SERVER_ERROR = 500;
export const STATUS_NOT_IMPLEMENTED = 501;
export const STATUS_BAD_GATEWAY = 502;
export const STATUS_SERVICE_UNAVAILABLE = 503;
export const STATUS_GATEWAY_TIME_OUT = 504;
export const STATUS_HTTP_VERSION_NOT_SUPPORTED = 505;
export const STATUS_VARIANT_ASLO_NEGOTIATES = 506;
export const STATUS_INSUFFICIENT_STORAGE = 507;
export const STATUS_LOOP_DETECTED = 508;
export const STATUS_NOT_EXTENDED = 510;
export const STATUS_NETWORK_AUTHENTICATION_REQUIRED = 511;

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
export {get};
export {set};

export {redirect};

export {reject};

export {created};
export {methodNotAllowed};
export {notFound};
export {unauthorized};
export {badRequest};

const DEFAULT_NAME = "analog";
const DEFAULT_VERSION = 0;

const FLAG_NODATE       = 0x01 << 0;
const FLAG_NOOUTPUT     = 0x01 << 1;

class InternalRequest {
    constructor(message, response) {
        this.headers = message.headers;
        this.method = message.method;
        this.statusCode = message.statusCode;
        this.statusMessage = message.statusMessage;
        this.url = message.url;

        this._message = message;
        this._response = response;
        this._responded = false;
    }

    respond(init) {
        if (this._responded === true) {
            return Promise.reject(new Error("Already responded"));
        }

        this._responded = true;

        const headers = init.headers;
        const status = init.status || 200;
        const statusText = init.statusText || statusCodeToText(status);
        const body = init.body;

        const response = this._response;
        this._response = null;

        return new Promise((resolve, reject) => {
            response.on("finish", resolve);
            response.on("error", reject);

            try {
                for (let k in headers) {
                    response.setHeader(k, headers[k]);
                }
            } catch(error) {
                try {
                    response.writeHead(500, "");
                    response.end();
                } catch(error2) {
                }
                return reject(error);
            }

            try {
                response.writeHead(status, statusText);
                response.end(body);
            } catch (error) {
                return reject(error);
            }
        });
    }
}

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
        return this._request.headers[Str.lower(name)];
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
        this.headers = {};
        this.body = null;
        this.request = null;
    }

    header(name) {
        return this.headers[name];
    }

    hasHeader(name) {
        return name in this.headers;
    }

    setHeader(name, value) {
        this.headers[Str.lower(name)] = value;
    }
}

class ErrorResponse extends Response {
    constructor(status=400, message=null) {
        super(status);
        this.body = message || statusCodeToText(status);
        this.error = null;
    }
}

class FileResponse extends Response {
    constructor() {
        super();
    }
}

const State = resetState({});

/// Initialize and starts the underlying web server
///
/// ## Available options
/// - `port`, port to listen to. Leave blank for random port.
///
async function start(options={}) {
    if (State.hooks[HOOK_RESPOND]) {
        throw new Error("Already started");
    }

    hook(HOOK_RESPOND, handleRespondHook);
    hook(HOOK_LISTEN, handleListenHook);

    const info = await internalListen(options, handleRequest);

    await trigger(HOOK_LISTEN, info);

    return info;
}

async function shutdown() {
    if (State.server === null) {
        throw new Error("Server is not running");
    }

    return new Promise((resolve, reject) => {
       State.server.on("close", () => {
           resetState(State);
           resolve();
       });
       State.server.close();
    });
}

/// Returns current working directory of the application
function cwd() {
    return State.cwd;
}

/// Returns a dict with environment variables passed to the application
function env() {
    return Dict.clone(State.env);
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

function get(key, alt=null) {
    return key in State.kvstore ? State.kvstore[key] : alt;
}

function set(key, value=null) {
    if (value === null) {
        delete State.kvstore[key];
    }

    State.kvstore[key] = value;
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
    return reject(STATUS_METHOD_NOT_ALLOWED, object);
}

function notFound(object=null) {
    return reject(STATUS_NOT_FOUND, object);
}

function unauthorized(object=null) {
    return reject(STATUS_UNAUTHORIZED, object);
}

function badRequest(object=null) {
    return reject(STATUS_BAD_REQUEST, object);
}

function reject(status=STATUS_INTERNAL_SERVER_ERROR, object=null) {
    return new ErrorResponse(status, object);
}

// Callbacks

function resetState(state) {
    state.name = "analog";
    state.flags = 0;
    state.version = 0;
    state.servername = null;
    state.initialized = false;
    state.jsontabs =  0;
    state.handlers = [];
    state.hooks = Dict.create();
    state.config = Dict.create();
    state.kvstore =  Dict.create();
    state.server = null;
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

// Callbacks

async function handleRequest(internalRequest) {
    let url, initialError;

    try {
        url = Url.parse(internalRequest.url);
    } catch(error) {
        url = Url.parse("/");
        initialError = error;
    }

    const {callback, params} = findRoute(url.pathname);
    const request = new Request(internalRequest, url, params);

    let response;

    try {
        if (initialError) {
            response = Promise.reject(initialError);
        } else {
            response = await routeRequest(request, callback);
        }
    } catch (error) {
        if (error instanceof Response) {
            response =  await makeResponse(error.request || request, error);
        } else {
            let result;

            try {
                result = await trigger(HOOK_REQUESTERROR, error);
            } catch (innerError) {
                result = await makeErrorResponse(request, error, innerError);
            }

            if (result instanceof Response) {
                response = result;
            } else {
                response = await makeErrorResponse(request, error);
            }
        }
    }

    try {
        await trigger(HOOK_RESPOND, response);
        internalRequest.respond(response);
    } catch (innerError) {
        try {
            if (HOOK_ERROR in State.hooks === false) {
                throw error;
            }
            response = trigger(HOOK_ERROR, error);
        } catch (unhandledError) {
            return handleUnhandledError(httpRequest, unhandledError);
        }
    }
}

function handleStartupHook() {
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
    console.log("--- handleUnhandledError ---");
    console.log(error);
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

async function routeRequest(request, callback) {
    const result = await trigger(HOOK_REQUEST, request);

    if (result) {
        return makeResponse(request, result);
    }

    if (!callback) {
        return makeResponse(request, notFound());
    }

    const result2 = await callCallbackChain(callback, request);
    return makeResponse(request, result2);
}

async function callCallbackChain(value, params) {
    if (typeof value !== "function") {
        return Promise.resolve(value);
    }

    try {
        const result = value(params);

        if (result instanceof Promise) {
            return callCallbackChain(await result, params);
        }

        return callCallbackChain(result, params);
    } catch (error) {
        return Promise.reject(error);
    }
}

async function callPromiseChain(callbacks, idx, params, arg=void(0)) {
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

    const arg2 = await promise;

    return callPromiseChain(callbacks, idx + 1, params, arg2 || arg);
}

function makeErrorResponse(request, error, _outerError) {
    const status = error.httpStatus || STATUS_INTERNAL_SERVER_ERROR;
    const response = reject(status);
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
        response.body = statusCodeToText(response.status);
    } else if (response.status === STATUS_OK && response.body === null) {
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
    if (response.hasHeader("server") === false) {
        response.setHeader("server", State.servername);
    }

    if (response.hasHeader("date") === false && isset(FLAG_NODATE) === false) {
        response.setHeader("date", (new Date).toUTCString());
    }

    if (response.hasHeader("content-type") === false &&
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
            response.body = statusCodeToText(response.status);
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
                     || statusCodeToText(response.code);
    }
}

function pad(n) {
    return n < 10 ? `0${n}` : String(n);
}

function internalListen(options, requestHandler) {
    State.server = Http.createServer();

    return new Promise((resolve, reject) => {
        State.server.on("error", error => {
            State.server = null;
            reject(error);
        });

        State.server.on("listening", _ => {
            const {port, address, family} = State.server.address();
            resolve({port, address, family});
        });

        State.server.on("request", (message, response) => {
            requestHandler(new InternalRequest(message, response));
        });

        if (options.port && options.hostname) {
            State.server.listen(options.port, options.hostname);
        } else if (options.port) {
            State.server.listen(options.port);
        } else {
            State.server.listen();
        }
    });
}

/// Get the status text for a HTTP response code
function statusCodeToText(code) {
    // TODO: add all status codes
    switch (code) {
    default:
        return String(code);
    case STATUS_OK:
        return "OK";
    case STATUS_CREATED:
        return "Created";
    case STATUS_ACCEPTED:
        return "Accepted";
    case STATUS_NON_AUTHORITATIVE_INFORMATION:
        return "Non-Authoritative Information";
    case STATUS_NOT_FOUND:
        return "Not found";
    case STATUS_NO_CONTENT:
        return "No Content";
    case STATUS_UNAUTHORIZED:
        return "Unauthorized";
    case STATUS_RESET_CONTENT:
        return "Reset Content";
    case STATUS_PARTIAL_CONTENT:
        return "Partial Content";
    case STATUS_MULTI_STATUS:
        return "Multi-Status";
    case STATUS_ALREADY_REPORTED:
        return "Already Reported";
    case STATUS_IM_USED:
        return "IM Used";
    case STATUS_INTERNAL_SERVER_ERROR:
        return "Internal Server Error";
    }
}
