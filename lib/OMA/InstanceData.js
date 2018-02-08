define([
    'Atem-CPS/CPS/elements/PropertyDict'
], function(
    PropertyDict
) {
    "use strict";
    // jshint esnext:true, newcap:false
    /*global Symbol*/


    /**
     * The idea of InstanceData is to separate the data from the interface,
     * so that an instance can be treated as disposable. InstanceData
     * all what makes an instance unique besides it's position in the
     * instance tree and it's pattern. That is:
     *
     *   - id
     *   - classes
     *   - attachment
     *   - properties
     *   - (defaults)
     *
     * I'm unsure yet with:
     *   - baseInstances
     *   - the information how to combine baseInstances
     * These were not part of the node data originally, `baseNode` was
     * added late and rudimentary.
     * It feels like the right thing to have in here, because `properties`
     * will be dependent on baseInstances. Though, there may be cases
     * where it is hard to serialize or such! This is an interesting
     * tinker problem.
     *
     * extra goal: make this immutable/copy on write so sharing it
     * is dead cheap.
     * Problem: propertyDict should be immutable for this.
     *
     * Then, when InstanceData is replaced because of changes or because
     * of a complete replacement, Instance would have to figure out what
     * has changed and trigger the appropriate events (_triggerPropertyChange).
     *
     * PropertyDict is a rather complex object, for the sake of simplicity
     * I'll stick with the defensive copying/mutable model for InstanceData.
     */
    function InstanceData(makeProperty) {
        Object.defineProperty(this, 'makeProperty', {
            value: makeProperty
        });

        this._attachedData = null;
        this._id = null;
        this._classes = new Set();
        // this has higher precedence than any rule loaded by CPS
        // and it is unique to this Instance.
        // DOM Elements have element.style, this is analogous
        Object.defineProperty(this, 'properties', {
            value: new PropertyDict([], '*element properties*')
          , enumerable: true
        });

        this._baseInstances = null;
    }

    var _p = InstanceData.prototype;

    _p.setId = function(id) {
        if(this._id !== id) {
            this._id = id;
            return true;
        }
    };

    Object.defineProperty(_p, 'id', {
        get: function(){ return this._id; }
    });

    _p._setCLass = function(name) {
        if(name !== '' && !this._classes.has(name)) {
            this._classes.add(name);
            return true;//changed
        }
        return false;
    };

    var _cache = Symbol('cache');

    _p.setClass = function(name) {
        if(this._setCLass(name)) {
            delete this._classes[_cache];
            return true;//changed
        }
        return false;
    };

    _p.setClasses = function(classes) {
        var i, l, changed = false;
        for(i=0,l=classes.length;i<l;i++) {
            changed = this._setCLass(classes[i]) || changed;
        }
        if(changed) {
            delete this._classes[_cache];
            return true;//changed
        }
        return false;
    };

    _p.removeClass = function(name) {
        if(this._classes.has(name)) {
            this._classes.delete(name);
            delete this._classes[_cache];
            return true; // changed
        }
        return false;
    };

    _p.hasClass = function(name) {
        return this._classes.has(name);
    };

    Object.defineProperty(_p, 'classes', {
        get: function() {
            if(!(_cache in this._classes)) {
                this._classes[_cache] = Array.from(this._classes);
                Object.freeze(this._classes[_cache]);
            }
            return this._classes[_cache];
        }
      , enumerable: true
    });

    _p._dumpClasses = function() {
        if(this._classes.size)
            // we have classes
            return this.classes;
        return null;
    };

    _p._loadClasses = function(classes) {
        // do only if necessary and in a way that the 'classes' event
        // is triggered just once.
        var seen = new Set(), i, l, name, ownCLasses;
        for(i=0,l=classes.length;i<l;i++) {
            // check if there are new class names
            name = classes[i];
            seen.add(name);
            if(!this._classes.has(name)) {
                // at least one new name; mark for reset:
                this._classes = null;
                break;
            }
        }
        if(this._classes !== null) {
            ownCLasses = this.classes;
            for(i=0,l=ownCLasses.length;i<l;i++) {
                name = ownCLasses[i];
                // check if there are superfluous class names
                if(!seen.has(name)) {
                    // mark for reset
                    this._classes = null;
                    break;
                }
            }
        }
        if(this._classes === null) {
            // reset
            this._classes = new Set();
            this.setClasses(classes);
        }
    };

    /**
     * Attach custom data to the node.
     * When called with just one argument, a typeof 'object' the internal
     * object is replaced.
     * Otherwise two arguments: key, value are expected and written to
     * the internal object.
     *
     * This data can be anything but it should survive serialization
     * to JSON and YAML. The data won't be available to CPS and
     * not trigger any events on change (that could be changed).
     * ES6 Proxies may be an option to patch the observation yourself.
     * As of Feb 2015 they are in Firefox and Chrome/V8.
     *
     * Returns undefined.
     */
    _p.attachData = function(key, value) {
        if(arguments.length === 1 && typeof key === 'object') {
            this._attachedData = key;
            return;
        }
        if(!this._attachedData)
            this._attachedData = Object.create(null);
        this._attachedData[key] = value;
    };

    /**
     * When called without arguments, the internal object is deleted.
     * When called with one argument "key" the entry at key
     * of the internal object is deleted.
     *
     * Returns undefined.
     */
    _p.detachData = function(key) {
        if(arguments.length === 0)
            this._attachedData = null;
        else if(this._attachedData)
            delete this._attachedData[key];
    };
    /**
     * When called without arguments the internal object is returned.
     * When called with one argument "key" the value at key
     * of the internal object is returned.
     */
    _p.getAttachment = function(key, searchInBaseNodeChain) {
        if(arguments.length === 0)
            return this._attachedData;
        if(this._attachedData && key in this._attachedData)
            return this._attachedData[key];
        // maybe the instance should do this?
        // it's ultra hard to pick one value when the baseInstances are
        // multiple!
        FIXME; if(searchInBaseNodeChain && this._baseNode)
        return this._baseNode.getAttachment(key, searchInBaseNodeChain);
    };

    // FIXME: make this._attachedData immutable.js, it's a good fit.
    _p.dumpAttachment = function() {
        var k;
        if(this._attachedData)
            // check if there is at least one key in this._attachedData prior
            // to setting it. Hence 'for(k in ...) do(); break;' instead of just
            // 'if(this._attachedData) do();'
            for(k in this._attachedData)
                // In loadAttachment we do the same "deep clone"
                // But here we do it so that the returned data doesn't
                // change when this._attachedData changes.
                return JSON.parse(JSON.stringify(this._attachedData));
        return null;
    };

    // FIXME: remove this, just make sure the attachment object is not used
    // anywhere else!
    //_p.loadAttachment = function(attachment) {
    //    // This is a bit paranoid: serialize then deserialize
    //    // (poor mans deep clone ...) to break unwanted shared references
    //    // to attachment with other users of it. Otherwise, using
    //    // this.attachData(attachment) would do the thing just fine.
    //    this.attachData(JSON.parse(JSON.stringify(attachment)));
    //};

    _p.dumpProperties = function(simpleProperties) {
        var properties, result = null, i, l, k, keys, items;
        if(simpleProperties) {
            // Do a key: value serialization, looses double key entries
            // but is easier to read and write for humans
            properties = Object.create(null);
            keys =  this.properties.keys();
            for(i=0,l=keys.length;i<l;i++) {
                k = keys[i];
                properties[k] = this.properties.get(k).toString();
            }
            if(l)
                result = properties;
        }
        else {
            // Put each [key, value] pair as a list into a list.
            // This preserves all information of the PropertyDict, but
            // it's harder to read/modify for some humans, because there
            // are more brackets and such.
            properties = [];
            items = this.properties.items;
            for(i=0,l=items.length;i<l;i++)
                properties.push([items[i].name, items[i].value.toString()]);
            if(l)
                result = properties;
        }
        return result;
    };

    _p.loadProperties = function(properties) {
        // TODO: similar to _loadClasses, this should only trigger a change
        // event if necessary. I keep this for another iteration.
        // Should maybe be implemented in the PropertyDict.
        var newProperties = []
          , k, i, l
          ;
        if(!(properties instanceof Array))
            // used simpleProperties=true in
            for(k in properties)
                newProperties.push(this.makeProperty(k, properties[k]));
        else
            for(i=0,l=properties.length;i<l;i++)
                newProperties.push(this.makeProperty(properties[i][0], properties[i][1]));
        this.properties.splice(0, this.properties.length, newProperties);
    };

    /**
     * After this baseInstances is always an array. This means,
     * the instance doesn't inherit it's baseInstances from it's parent
     * anymore.
     */
    _p._spliceBaseInstances = function(index, deleteCount, insertions) {
        var newBaseInstances = this._baseInstances === null
                ? []
                : this._baseInstances.slice() // copy on write ...
          , args = [index, deleteCount]
          , deletions
          , insertions_ = insertions instanceof Array
                ? insertions
                : (insertions === undefined ? [] : [insertions])
          ;
        Array.prototype.push.apply(args, insertions_);
        deletions = Array.prototype.splice.apply(newBaseInstances, args);
        if(this._baseInstances === null || deletions.length || insertions.length) {
            Object.freeze(newBaseInstances);
            this._baseInstances = newBaseInstances;
            return [true, deletions]; // had changes
        }
        return [false, null];
    };

    Object.defineProperty(_p, 'baseInstances', {
        get: function() {
            // safe to return, it is frozen.
            return this._baseInstances;
        }
    });

    /**
     * Since an empty array and null have a different meaning here,
     * the empty array can't be optimized away!
     */
    _p._dumpBaseInstances = function() {
        return (this._baseInstances !== null
                    ? this._baseInstances.map(function(instance) {
                            return instance.getIndexPath();
                      })
                    : null
                );
    };

    /**
     * use setBaseInstances(null); to set this to the default (falling back)
     *
     * Note that the "had changes" return status may can have
     * false positives, it's not a qualitative indicator of new and the
     * old data, rather an indicator of the data manipulation that took place.
     */
    _p.setBaseInstances = function(instances) {
        var oldValue = this._baseInstances
          , newBaseInstances
          ;

        if(instances === null) {
            if(this._baseInstances === null)
                return [false, null]; // no change
            // not sure if returning `deleted` here is the right semantic
            return [true, oldValue];
        }
        newBaseInstances = instances.slice();// a copy
        Object.freeze(newBaseInstances);
        this._baseInstances = newBaseInstances;
        return [true, oldValue]; // had changes
     };

    _p.loadBaseInstances = function(root, indexPaths) {
        var instances =  indexPaths !== null
                    ? indexPaths.map(root.lookupIndexPath, root)
                    : null
                    ;
        return this.setBaseInstances(instances);
    };

    /**
     * Returns an object if there is any data to be serialized, otherwise null.
     *
     * The object is meant to be consumed by loadData and must be de-/serializable
     * by methods like JSON.stringify or yaml.safeDump without loss.
     *
     * dumpFlags: A bitmask (integer number) with the flags:
     *      dumpId           =    1
     *      dumpClasses      =    2
     *      dumpProperties   =    4
     *      dumpAttachedData =    8
     * default: dump all
     */
    _p.dumpDataForSerialization = function(simpleProperties, dumpFlags) {
        var result = Object.create(null)
          , data, k
          , flags = dumpFlags === undefined
                ? (0x01|0x02|0x04|0x08|0x10)//all
                : dumpFlags
          , dumpId = flags & 0x01
          , dumpClasses = flags & 0x02
          , dumpProperties = flags & 0x04
          , dumpAttachedData = flags & 0x08
          , dumpBaseInstances = flags & 0x10
          ;

        if(dumpId && this._id)
            result.id = this._id;

        if(dumpClasses) {
            data = this._dumpClasses();
            if(data)
                result.classes = data;
        }

        if(dumpProperties) {
            data = this.dumpProperties(simpleProperties);
            if(data)
                result.properties = data;
        }

        if(dumpAttachedData) {
            data = this.dumpAttachment();
            if(data)
                result.attachment = data;
        }

        if(dumpBaseInstances) {
            data = this._dumpBaseInstances();
            if(data)
                result.baseInstances = data;
        }

        for(k in result)
            // only return result if there is any content
            return result;
        return null;
    };

    InstanceData.deserializeFromObject = function(root, makeProperty, data) {
        var instanceData = new InstanceData(makeProperty);
        if('id' in data)
            instanceData.setId(data.id);
        if('classes' in data)
            instanceData.setClasses(data.classes);
        if('attachment' in data)
            instanceData.attachData(data.attachment);
        if('properties' in data)
            instanceData.loadProperties(data.properties);
        if('baseInstances' in data)
            instanceData.loadBaseInstances(root, data.baseInstances);
        return instanceData;
    };

    return InstanceData;
});
