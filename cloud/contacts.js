/* global Parse */
/* global console */
/* global module */
(function() {
'use strict';

var _ = require('cloud/lodash.js');
var acl = require('cloud/acl.js');

/**
 * This function can take params.phone and params.facebook that will be stored in the database.
 * It then queries the matching users to store them for quick access
 */
function refreshContacts(user, params) {
  var queryUd = new Parse.Query('UserData');
  queryUd.equalTo('user', user);
  return queryUd.first().then(function(userData) {
    if (userData) {
      var hashes = userData.get('contactsHash') ? userData.get('contactsHash') : {};
      // UserData already exists, we update it
      if (params.phone && _.isArray(params.phone.contacts) && _.isString(params.phone.hash)) {
        userData.set('phoneContacts', params.phone.contacts);
        hashes.phone = params.phone.hash;
      }
      if (params.facebook && _.isArray(params.facebook.contacts) && _.isString(params.facebook.hash)) {
        userData.set('facebookContacts', params.facebook.contacts);
        hashes.facebook = params.facebook.hash;
      }
      userData.set('contactsHash', hashes);
      return userData.save();
    }
    else {
      // UserData doesn't already exists, we create it
      var UserData = Parse.Object.extend('UserData');
      var newUserData = new UserData({ ACL: acl.getACL([user], true) });
      var udObject = { user: user };
      var newHashes = {};
      if (params.phone && _.isArray(params.phone.contacts) && _.isString(params.phone.hash)) {
        udObject.phoneContacts = params.phone.contacts;
        newHashes.phone = params.phone.hash;
      }
      if (params.facebook && _.isArray(params.facebook.contacts) && _.isString(params.facebook.hash)) {
        udObject.facebookContacts = params.facebook.contacts;
        newHashes.facebook = params.facebook.hash;
      }
      udObject.contactsHash = newHashes;
      return newUserData.save(udObject);
    }
  })
  .then(function(userdata) {
    // Get slovers by phoneNumber
    var queryPhone = new Parse.Query(Parse.User);
    queryPhone.select('objectId');
    queryPhone.containedIn('phoneNumber', userdata.get('phoneContacts'));

    // Get slovers by facebookId
    var queryFacebook = new Parse.Query(Parse.User);
    queryFacebook.select('objectId');
    queryFacebook.containedIn('facebookId', userdata.get('facebookContacts'));
    queryFacebook.exists('phoneNumber'); // Don't return users without phone

    return Parse.Query.or(queryPhone, queryFacebook).find().then(function(sloveContacts) {
      var listWithoutSelf = _.reject(sloveContacts, { 'id': user.id });
      var sloveContactsIds = _.map(listWithoutSelf, 'id');
      // Save without keeping self contact if it made a match (self phone in phone contacts...)
      userdata.set('sloveContacts', sloveContactsIds);
      return userdata.save();
    });
  },
  function() {
    console.error('Something went wrong on UserData refresh for user ' + user.id);
  });
}

// Exporting for use with require()...
module.exports = { refreshContacts: refreshContacts };

})();
