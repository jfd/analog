//! MIME related functions

cflags: "MODE_REVAMP";

import {extensionToMimeType} from "./res/mimedb.mjs";
import {mimeTypes} from "./res/mimedb.mjs";

import {List} from "//es.parts/ess/0.0.1/";
import {Path} from "//es.parts/ess/0.0.1/";
import {Str} from "//es.parts/ess/0.0.1/";

export {charset};
export {compressible};
export {contentType};
export {extension};
export {extensions};
export {lookupPath};
export {lookup};

/// Get the default charset for a MIME type.
function charset(mimeType) {
    const entry = mimeTypes[mimeType];

    if (entry && entry.charset) {
        return entry.charset;
    }

    if (Str.begins(mimeType, "text")) {
        return "UTF-8";
    }

    return void(0);
}

/// Determinds whatever `mimeType` is comperssible with GZIP or not.
function compressible(mimeType) {
    const entry = mimeTypes[mimeType];
    return entry ? entry.compressible : false;
}

/// Create a full Content-Type header given a MIME type or extension.
function contentType(extension) {
    const mime = extensionToMimeType[normalizeExtension(extension)];
    const set = charset(mime);

    return set ? `${mime}; charset=${Str.lower(set)}` : mime;
}

function extension(mimeType) {
    const entry = mimeTypes[mimeType];
    return entry && entry.extensions ? List.head(entry.extensions) : void(0);
}

function extensions(mimeType) {
    const entry = mimeTypes[mimeType];
    return entry && entry.extensions ? List.clone(entry.extensions) : void(0);
}

function lookup(extension) {
    return extensionToMimeType[normalizeExtension(extension)] || void(0);
}

function lookupPath(path) {
    return lookup(Path.extname(path));
}

// Internals

function normalizeExtension(ext) {
    return Str.lower(Str.begins(ext, ".") ? Str.subl(ext, 1) : ext);
}
