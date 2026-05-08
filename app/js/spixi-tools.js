// Copyright (C) 2026 IXI Labs
// Spixi Tools v0.2

function executeUiCommand(cmd) {
    SpixiTools.executeUiCommand.apply(null, arguments);
}

var SpixiTools = {
    version: 0.2,
    base64ToBytes: function (base64) {
        const binString = atob(base64);
        return new TextDecoder().decode(Uint8Array.from(binString, (m) => m.codePointAt(0)));
    },
    executeUiCommand: function (cmd) {
        try {
            var decodedArgs = new Array();
            for (var i = 1; i < arguments.length; i++) {
                decodedArgs.push(SpixiTools.base64ToBytes(arguments[i]));
            }
            cmd.apply(null, decodedArgs);
        } catch (e) {
            alert("Cmd: " + cmd + "\nError: " + e);
        }
    },
    unescapeParameter: function (str) {
        return str.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&bsol;/g, "\\")
            .replace(/&apos;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
    },
    escapeParameter: function (str) {
        return str.replace(/&(?!#\d+;|#x[\da-fA-F]+;)/g, "&amp;").replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;").replace(/\\/g, "&bsol;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
    getTimestamp: function() { return Math.round(+new Date() / 1000); }
};
