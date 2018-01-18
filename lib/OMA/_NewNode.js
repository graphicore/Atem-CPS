define([
    'Atem-CPS/errors'
  , 'Atem-CPS/emitterMixin'
], function(
    errors
  , emitterMixin
) {
    "use strict";
    // jshint esnext:true

    const OMAError = errors.OMA
      , NotImplementedError = errors.NotImplemented
      , emitterMixinSetup = {
              stateProperty: '_channel'
            , onAPI: 'on'
            , offAPI: 'off'
            , triggerAPI: '_trigger'
        }
      ;

    function _Node() {
        /*jshint validthis:true*/
        if(this.constructor.prototype === _p)
            throw new OMAError('OMA _Node must not be instantiated directly');

        // these children will be often multiple times the same, hence it will
        // be hard to tell which instances belong to a pattern
        // the reliable way is to communicate with the instances via indexes,
        // because those indexes must be/will be kept always in sync.
        this._children = [];
        emitterMixin.init(this, emitterMixinSetup);
    }
    var _p = _Node.prototype;
    _p.constructor = _Node;
    // see OMAController._initPattern!
    _Node.$inject = null;

    emitterMixin(_p, emitterMixinSetup);

    /**
     * Implement a getter for CPS Type in sub classes of _Node, we need
     * it for the cps selector engine and some other things.
     *
     * cpsType should be a simple string, minuses are ok, don't do
     * anything fancy.
     *
     * Don't use already taken names.
     * TODO: come up with some namespace scheme to make this easier.
     */
    Object.defineProperty(_p, 'type', {
        get: function() {
            // this should be implemented by items inheriting from _Node
            throw new NotImplementedError('Implement CPS-Type name!');
        }
    });

    _p.toString = function() { return ['<Pattern:', this.type, '>'].join('');};

    _p.isOMANode = function(item) {
        return item instanceof _Node;
    };

    /**
     * Enhance this dict with accepted children type: Constructor pairs
     *
     * TODO: add duck-typing as a strategy, e.g. "has a public draw function"
     */
    _p._acceptedChildren = Object.create(null);

    _p.qualifiesAsChild = function(item) {
        if(!this.isOMANode(item))
            return false;

        if(item.type in this._acceptedChildren
                    && item instanceof this._acceptedChildren[item.type])
            return true;
        return false;
    };

    /* This is very unspecific on purpose, I can think of lots of
     * options to define validators for different purposes.
     * One of the biggest alternatives was to inject them via
     * the CPS-Controller into StyleDict, which would make the
     * validators of an OMA implementation configurable per application.
     * If that kind of freedom is needed (I think this is rather
     * a bad idea), then the object model could add a setValidator
     * method, operated by the CPS-Controller, for example.
     * However, to make an OM behave constantly across applications
     * (I think this is desirable) it is good to attch these
     * validators to the object model.
     */
    _p.getValidator = function(key) {
        //jshint unused:false
        return null;
    };

    /**
     * some discussion of this is in _Root.
     */
    _p.isRoot = function(){
        FIXME;// how to know, we're removing the _Root type
        return false;
    };

    Object.defineProperty(_p, 'children', {
        /**
         * returns a copy of this._children so we can't mess around
         * with the list of children via public interfaces.
         *
         * FIXME: defensive copying here! use rather an immutable.js
         *        implementation?
         */
        get: function(){ return this._children.slice(); }
    });

    Object.defineProperty(_p, 'childrenLength', {
        /**
         * Faster than calling node.children.length, because that creates
         * a copy of this._children
         */
        get: function(){ return this._children.length; }
    });

    _p.getChild = function(index) {
        return this._children[index];
    };

    /**
     * Set this to true in a subclass if it should manage the ids of
     * it's descendants.
     */
    Object.defineProperty(_p, 'idManager', {
        value: false
    });

    function _getCanonicalStartIndex(start, length) {
        if(start >= length)
            return length;
        if(start < 0)
            return Math.max(0, length - start);
        return start;
    }

    // this used to have a splice function, but with the new model of patterns
    // and instances this becomes overly complex.
    // instead there will be two methods as a replacemant:
    // `insertAt(startIndex, _insertions)` and removeFrom(startIndex, deleteCount)
    // these two should be able to replace most usages of `node.splice`
    // NOTE: moving is no longer supported via this interface, since
    // the same instance
    // _p.splice = function(startIndex, deleteCount, _insertions /* single item or array of items */)

    // TODO: maybe we rather need a move that can also move between nodes
    // not just within one, *WHILE* also moving the instance data (if possible)
    // though, moving instance data may only be feasible automatically when
    // moving within the same node! In other cases, instance level
    // cut/copy/paste of instance data may be better suited.
    _p.move = function(from, to) {
        // jshint unused:vars
        throw new NotImplementedError('TODO: if a use case comes up.');
    };

    _p.insertAt = function(startIndex,  _insertions /* single item or array of items */) {
        if(Object.isFrozen(this._children))
            throw new OMAError('Inserting children is not allowed in this element.');
        if(!insertions.length)
            return;
        var insertions = _insertions instanceof Array
                ? _insertions
                : (_insertions === undefined ? [] : [_insertions])
          , canonicalStartIndex = _getCanonicalStartIndex(startIndex, this._children.length)
          , notAccepted, args
          ;

        notAccepted = insertions.filter(function(item) {
            //jshint validthis: true
            return !this.qualifiesAsChild(item);
        }, this);
        if(notAccepted.length)
            throw new OMAError([this, 'doesn\'t accept', notAccepted.join(', ')
                                        , 'as child type(s).'].join(' '));

        FIXME;// take care of circular references

        args = [canonicalStartIndex, 0];
        Array.prototype.push.apply(args, insertions);
        Array.prototype.splice.apply(this._children, args);

        // instances must now deal with initializing/reorganizing their children
        this._trigger('inserted', [canonicalStartIndex, insertions.length]);
    };

    _p.removeFrom = function(startIndex, deleteCount) {
        if(Object.isFrozen(this._children))
            throw new OMAError('Adding or removing children is not allowed in this element.');
        var canonicalStartIndex = _getCanonicalStartIndex(startIndex, this._children.length)
          , deleted
          ;

        deleted = this._children.splice(canonicalStartIndex, deleteCount);

        if(deleted.length)
            // instances must now deal with initializing/reorganizing their children
            // Sends also deleted, because we can't observe what has been
            // deleted in this node anymore; the instances can know though
            // because all child instances have a reference to their pattern.
            this._trigger('removed', [canonicalStartIndex, deleted.length, deleted]);
    };

    return _Node;
});
