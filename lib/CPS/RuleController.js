define([
    'Atem-CPS/errors'
  , './parsing/parseRules'
  , 'obtain/obtain'
  , 'Atem-IO/tools/readDirRecursive'
], function(
    errors
  , parseRules
  , obtain
  , readDirRecursive
) {
    "use strict";
    var KeyError = errors.Key
      , CPSRecursionError = errors.CPSRecursion
      ;

    // FIXME: note that we have a race condition in here:
    //        One request with an older result can respond after
    //        a newer result was cached, the most obvious example
    //        is:
    //              ruleController.getRule(true, name)
    //              ruleController.getRule(false, name)
    //
    //        The second call will write the cache before the first call.
    //        This problem exists with all asynchronous requests, of
    //        course, but in this case it is more probable.
    //        See the implementation of `getRule` (the `rule` getter)
    //        for an attempt to improve the situation, and a further comment.

    function RuleController(io, cpsDir, initializePropertyValue, selectorEngine) {
        this._io = io;
        this._cpsDir = cpsDir;
        this._commissionIdCounter = 0;
        this._rules = Object.create(null);
        Object.defineProperty(this, 'initializePropertyValue', {
            value: initializePropertyValue
          , enumarable: true
          , writable: false
        });
        Object.defineProperty(this, 'selectorEngine', {
            value: selectorEngine
          , enumarable: true
          , writable: false
        });
        this._markDirtyCallback = [this, '_markDirtyHandler'];
    }

    var _p = RuleController.prototype;

    _p._isCached = function(sourceName) {
        return (sourceName in this._rules) && this._rules[sourceName].cached;
    };

    _p._markDirtyHandler = function(sourceName, channelKey, eventData) {
        //jshint unused: vars
        this._rules[sourceName].dirty = true;
    };

    _p._set = function(sourceName, rule, commissionId) {
        var record;
        if(!(sourceName in this._rules))
            record = this._rules[sourceName] = {
                propertyCollection: rule
              , subscription: rule.on('update', this._markDirtyCallback, sourceName)
            };
        else {
            record = this._rules[sourceName];
            record.propertyCollection.reset(rule.items, rule.source, rule.lineNo);
        }
        record.commissionId = commissionId;
        record.cached = true;
        record.dirty = false;
    };

    _p._readFile = function(async, fileName) {
                            return this._io.readFile(async, fileName); };

    _p._getFilePath = function(sourceName) {
        return [this._cpsDir, sourceName].join('/');
    };

    _p._getRule = obtain.factory(
        {
            fileName: ['importing', 'sourceName', function(importing, sourceName) {
                if(sourceName in importing)
                    throw new CPSRecursionError(sourceName + ' @imports itself: '
                                    + Object.keys(importing).join(' » '));
                importing[sourceName] = true;
                return this._getFilePath(sourceName);
            }]
          , cps: [false, 'fileName', 'commissionId', _p._readFile]
          , api: ['importing', function(importing) {
                // return the api needed by parseRules.fromString
                // but create a version of `_getRule` that is aware of the
                // @import history `importing`
                var api = {
                    initializePropertyValue: this.initializePropertyValue
                  , selectorEngine: this.selectorEngine
                  , getRule: function ruleControllerGetRuleAPI(async, sourceName) {
                                return this._getRule(async, importing, sourceName);
                             }.bind(this)
                };
                return api;
            }]
          , rule: ['cps', 'sourceName', 'commissionId', 'importing', 'api',
                function(cps, sourceName, commissionId, importing, api) {
                    if(!this._isCached(sourceName)
                            // There is a current cache but it was commissioned
                            // before this request, and finished loading before it.
                            // FIXME: a maybe better alternative would be
                            //        to fail here!
                            || this._isCached(sourceName) && commissionId >= this._rules[sourceName].commissionId)
                    {
                        var rule = parseRules.fromString(cps, sourceName, api);
                        this._set(sourceName, rule, commissionId);
                    }
                    delete importing[sourceName];
                    return this._rules[sourceName].propertyCollection;
                }]
          , commissionId:[function(){ return this._commissionIdCounter++;}]
        }
      , {cps: [true, 'fileName', 'commissionId', _p._readFile]}
      , [ 'importing', 'sourceName']
      , function job(obtain, importing, sourceName) {
            if(!this._isCached(sourceName))
                obtain('rule');
            return this._rules[sourceName].propertyCollection;
        }
    );

    _p.getRule = function(async, sourceName) {
        // initial recursion detection stack
        var importing = Object.create(null);
        return this._getRule(async, importing, sourceName);
    };

    /**
     * Reload an existing CPS rule
     *
     * This is used with an file system monitoring event emitter.
     * But the concept as it is now plays bad with an interactive
     * environment. So that not both "sources of change" should be
     * used at the same time.
     *
     * It would be better to have just one "source of change",
     * a change in the file system source should be channeled into
     * the stream of changes of the the PropertyCollection itself,
     * just like user interaction. Thus, having a good diffing algorithm
     * would be a blast! And skipping all the updating in the case
     * of this.saveChangedRules is called would be wise!
     */
    _p.reloadRule = function(async, sourceName) {
        if(!(sourceName in this._rules))
            throw new KeyError('Can\'t reload rule "'+ sourceName
                                +'" because it\'s not in this controller');
        // mark as uncached
        this._rules[sourceName].cached = false;
        return this.getRule(async, sourceName);
    };

    /**
     * Create a new file or override an existing one
     *
     * FIXME/TODO:
     * Initially RuleController did only reading and re-reading of cps files.
     * Eventually we will also need creating, updating and removing of cps files
     * and PropertyCollections.
     * This will need some concept to work without race conditions and
     * in a reliable fashion.
     *
     * This method is very simple, it will create a new file or overide
     * an existing file. There is no guard that keeps this method from
     * overiding existing files, because the io api doesn't suppport that.
     *
     * Keep that in mind when using this method and if this behavior creates
     * a problem for your case, please report it, so that we can think of a
     * sound solution.
     */
    _p.write = function(async, sourceName, content) {
        var path = this._getFilePath(sourceName)
          , _content = content === undefined ? '' : content
          ;
        return this._io.writeFile(async, path, _content);
    };

    _p.saveRuleIfChanged = function(async, sourceName) {
        var rule = this._rules[sourceName];
        if(rule && rule.dirty) {
            this.write(async, sourceName, '' + rule.propertyCollection);
            rule.dirty = false;
        }
    };
    _p.saveChangedRules = function(async) {
        // FIXME: when there is a filesystem change handler, via reloadRule
        // the here saved files will be updated immediately.
        // We got to break that for performance reasons. Invalidating
        // and reloading all rules is a big performance hit and in this
        // case just unnecessary.
        var sourceName, rule;
        for(sourceName in this._rules) {
            rule = this._rules[sourceName];
            if(rule.dirty) {
                this.write(async, sourceName, '' + rule.propertyCollection);
                rule.dirty = false;
            }
        }
    };

    /**
     * Return all cps filenames within the cps directory.
     *
     * There may be more loadable rules when loaded with a relative sourceName.
     * But that is not supported by this method.
     */
    _p.getAvailableRules = obtain.factory(
        {
            files: [function() {
                return readDirRecursive(false, this._io, this._cpsDir);
            }]
          , trimmed: ['files', function(files) {
                var i,l
                  , result = []
                  , trimLength =  this._cpsDir.length+1
                  , file
                  ;
                for(i=0,l=files.length;i<l;i++) {
                    file = files[i];
                    if(file.slice(-4) !== '.cps')
                        continue;
                    result.push(file.slice(trimLength));
                }
                return result;
            }]
        }
      , {
            files: [function() {
                return readDirRecursive(true, this._io, this._cpsDir);
            }]
        }
      , []
      , function job (obtain) {
            return obtain('trimmed');
        }
    );

    return RuleController;
});
