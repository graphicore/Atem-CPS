define([
], function(
) {
    "use strict";
    /**
     * This is the RootAPI of an OMA-Tree. The Root node will need access
     * to this.
     */
    function RootAPI(controller) {
        this._controller = controller;
    }

    _p.removeFromTree = function(node) {
        this._controller.purgeNode(node);
    };

    _p.query = function(selector, scope) {
        return this._controller.query(selector, scope);
    };
    _p.queryAll = function(selector, scope) {
        return this._controller.queryAll(selector, scope);
    };

    _p.getComputedStyleFor = function(node) {
        return this._controller.getComputedStyle(node);
    };

    return RootAPI;
});
