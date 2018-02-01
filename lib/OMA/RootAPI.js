define([
], function(
) {
    "use strict";
    /**
     * This is the RootAPI of an OMA-Tree. The Root node will need access
     * to this.
     */
    function RootAPI(controller) {
        Object.defineProperty(this, 'controller', {
            value: controller
          , enumerable: true
        });
    }
    var _p = RootAPI.prototype;
    _p.constructor = RootAPI;

    _p.removeFromTree = function(node) {
        // TODO: we must checks if this is permissible
        this.controller.purgeNode(node);
    };

    _p.query = function(selector, scope) {
        return this.controller.query(selector, scope);
    };
    _p.queryAll = function(selector, scope) {
        return this.controller.queryAll(selector, scope);
    };

    _p.getComputedStyleFor = function(node) {
        return this.controller.getComputedStyle(node);
    };

    return RootAPI;
});
