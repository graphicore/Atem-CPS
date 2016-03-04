define([
    'Atem-Errors/errors'
], function(
    atemErrors
) {
    var errors = Object.create(atemErrors)
      , makeError = atemErrors.makeError.bind(null, errors)
      ;

    makeError('CPS', undefined, errors.Error);
    makeError('CPSKey', undefined, errors.Error);
    makeError('OMA', undefined, errors.CPS);
    makeError('OMAId', undefined, errors.CPS);
    makeError('CPSRecursion', undefined, errors.CPS);
    makeError('CPSRecursionKey', undefined, errors.CPSKey);
    makeError('CPSFormula', undefined, errors.CPS);
    makeError('Project', undefined, errors.CPS);
    makeError('PointPen', undefined, errors.CPS);
    makeError('CPSParser', undefined, errors.CPS);

    return errors;
});
