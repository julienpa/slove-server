/* global Parse */
/* global module */
(function() {
'use strict';

var _ = require('cloud/lodash.js');

/**
 * ACL helper
 */
function getACL(users, writeAccess, publicRead) {
  var acl = new Parse.ACL();
  if (_.isString(users) && users === 'master') {
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
  }
  else if (_.isArray(users)) {
    _.each(users, function(user) {
      acl.setReadAccess(user, true);
      acl.setWriteAccess(user, writeAccess ? writeAccess : false);
    });
    acl.setPublicReadAccess(publicRead ? publicRead : false);
  }
  return acl;
}

// Exporting for use with require()...
module.exports = { getACL: getACL };

})();
