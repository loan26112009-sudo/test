/**
 * CSInterface - Interface de communication CEP <-> Premiere Pro
 * Version minimale fonctionnelle pour AutoCut Silence
 */

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};

function CSInterface() {
    this._isLoaded = (typeof window.__adobe_cep__ !== "undefined");
}

CSInterface.prototype.evalScript = function(script, callback) {
    if (this._isLoaded) {
        window.__adobe_cep__.evalScript(script, callback || function() {});
    } else {
        // Mode démo (hors Premiere Pro)
        if (callback) callback('{"error":"Hors Premiere Pro - mode démo"}');
    }
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    if (this._isLoaded) {
        window.__adobe_cep__.addEventListener(type, listener, obj);
    }
};

CSInterface.prototype.removeEventListener = function(type, listener) {
    if (this._isLoaded) {
        window.__adobe_cep__.removeEventListener(type, listener);
    }
};

CSInterface.prototype.getSystemPath = function(pathType) {
    if (this._isLoaded) {
        var path = window.__adobe_cep__.getSystemPath(pathType);
        return path;
    }
    return "";
};

CSInterface.prototype.isLoaded = function() {
    return this._isLoaded;
};

CSInterface.prototype.getApplicationID = function() {
    if (this._isLoaded) {
        var appInfo = window.__adobe_cep__.getHostEnvironment();
        var info = JSON.parse(appInfo);
        return info.appId || "PPRO";
    }
    return "PPRO";
};
