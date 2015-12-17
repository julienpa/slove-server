/* global Parse */
/* global console */
/* global module */
(function() {
'use strict';

var acl = require('cloud/acl.js');

/**
 * This function can take params.phone and params.facebook that will be stored in the database.
 * It then queries the matching users to store them for quick access
 */

function addActivity(params) {
  Parse.Cloud.useMasterKey();
  var Activity = Parse.Object.extend('Activity');
  var activity = new Activity({ ACL: acl.getACL([params.user]) });
  var activityData = {
    user: params.user,
    activityType: params.type,
    activityValue: params.value
  };
  if (params.relatedUser) {
    activityData.relatedUser = params.relatedUser;
  }
  return activity.save(activityData);
}

// Exporting for use with require()...
module.exports = {
  addActivity: addActivity
};

})();
