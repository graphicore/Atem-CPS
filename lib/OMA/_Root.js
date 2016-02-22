define([
    './_Node'
], function(
    Parent
) {
    "use strict";
    /**
     * This is the root element of an OMA-Tree.
     *
     * It's needed as a scope for cps queries that search
     * in the scope of an entire OMA-Tree. And it's used to check if an
     * element belongs to the OMA-Tree. Other
     *
     *
     * It holds the reference to the OMA-Controller
     */
    function _Root(controller) {
        Parent.call(this);
        this._controller = controller;
    }
    var _p = _Root.prototype = Object.create(Parent.prototype);
    _p.constructor = _Root;

    // This can be overidden by subclasses.
    Object.defineProperty(_p, 'type', {
        /* this is used for CPS selectors*/
        value: 'root'
    });

    Object.defineProperty(_p, 'root', {
        get: function(){ return this; }
    });

    // stop acquiring indexPath segments, see _Node
    Object.defineProperty(_p, 'indexPath', {
        value: ''
    });

    _p.query = function(selector, scope) {
        return this._controller.query(selector, scope);
    };
    _p.queryAll = function(selector, scope) {
        return this._controller.queryAll(selector, scope);
    };

    _p.getComputedStyleFor = function(node) {
        return this._controller.getComputedStyle(node);
    };

    return _Root;
});
