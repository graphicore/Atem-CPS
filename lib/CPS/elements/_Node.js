define([
    'Atem-CPS/errors'
  , 'Atem-CPS/emitterMixin'
], function(
    errors
  , emitterMixin
) {
    "use strict";

    var AbstractInterfaceError = errors.AbstractInterface;

    var _id_counter = 0
      , emitterMixinSetup
      ;
    function getUniqueID() {
        return _id_counter++;
    }

    /**
     * All Elements in a PropertyCollection have this base type OR
     * should at least expose the same Interface (ducktyping).
     */
    function _Node(source, lineNo) {
        /*jshint validthis:true*/
        this._source = source;
        this._lineNo = lineNo;

        // the `reset` method of PropertyCollection will call this constructor
        // repeatedly. So we need a way to detect if this is was already
        // applied or not
        if(!this.__firstTimeInitFlag) {
            emitterMixin.init(this);
            Object.defineProperty(this, '__firstTimeInitFlag', {value: true});
            // FIXME: the uniqueID should only be available for CPS-Nodes
            // that are not considered immutable! We shouldn't use it for
            // Properties or Selectorlists
            Object.defineProperty(this, 'nodeID', {value: getUniqueID()});
        }
    }
    var _p = _Node.prototype;
    _p.constructor = _Node;

    emitterMixin(_p);

    _p.toString = function() {
        throw new AbstractInterfaceError('This interface is abstract and'
            + 'needs an implementation (CPS/elements/_Node.toString)');
    };

    /**
     * Trigger the destroy event and let the _Node clean up if needed.
     * When destroy is called, this _Node is probably alredy removed from
     * its hosting structure.
     *
     * Only the parent of this _Node may call destroy, when the node is
     * deleted. So don't use it anywhere else!
     * We will probably not have all nodes using this method, it depends
     * on the context.
     *
     * An `immutable` CPS-Node (like Paramter) must not change it's state
     * or the state when running this method. Because, after removal it
     * may be reused. Probably this is also true for `mutable` CPS-Nodes.
     * FIXME: Get the semantics straight io this. Maybe it needs renaming,
     * maybe we can remove it.
     */
    _p.destroy = function(data) {
        this._trigger('destroy', data);
    };

    function _getterCreator(item) {
        /*jshint validthis:true*/
        var external = item[0]
          , internal = item[1]
          ;
        Object.defineProperty(this, external, {
            get: function(){ return this[internal]; }
        });
    }

    ([
        ['source', '_source']
      , ['lineNo', '_lineNo']
    ].forEach(_getterCreator, _p));

    return _Node;
});
