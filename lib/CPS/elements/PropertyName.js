define([
    './_Name'
], function(
    Parent
) {
    "use strict";
    /**
     * The name of a Property.
     */
    function PropertyName(name, comments ,source, lineNo) {
        Parent.call(this, name, comments ,source, lineNo);
        // FIXME: detect invalid names!
        // Then set and use this.invalid and this message
        // For usage, modify Property to include the names status as well.
    }
    var _p = PropertyName.prototype = Object.create(Parent.prototype);
    _p.constructor = PropertyName;

    return PropertyName;
});
