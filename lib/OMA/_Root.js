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
     * It holds the reference to the OMA-Controller
     *
     * It's sometimes better to just mixin the methods of this prototype
     * rather than inherit from it. <multivers> of the MOM is an example
     * for that.
     */
    function _Root(controller) {
        Parent.call(this);
        this._controller = controller;
    }
    var _p = _Root.prototype = Object.create(Parent.prototype);
    _p.constructor = _Root;

    Object.defineProperty(_p, 'idManager', {
        value: true
    });

    Object.defineProperty(_p, 'root', {
        get: function(){ return this; }
    });

    _p._propertiesDependentOnParent = [];

    _p.removeFromTree = function(node) {
        if(node.parent) {
            // will call removeFromTree again, after `parent` got removed
            node.parent.remove(node);
            return;
        }
        this._controller.purgeNode(node);
    }

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
