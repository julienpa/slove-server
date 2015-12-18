/* global Parse */
/* global console */
/* global module */
(function() {
'use strict';

var _ = require('cloud/lodash.js');
var acl = require('cloud/acl.js');
var activities = require('cloud/activities.js');

var externalType = {
  phone: 1,
  facebook: 2,
  email: 3
};

/**
 * This function can take params.phone and params.facebook that will be stored in the database.
 * It then queries the matching users to store them for quick access
 */
function refreshContacts(user, params) {
  var previousPhoneList = [];
  var previousFacebookList = [];
  var promises = [];

  var queryUd = new Parse.Query('UserData');
  queryUd.equalTo('user', user);
  return queryUd.first().then(function(userData) {
    if (userData) {
      // UserData already exists, we update it

      var hashes = userData.get('contactsHash') ? userData.get('contactsHash') : {};

      if (params.phone && _.isArray(params.phone.contacts) && _.isString(params.phone.hash)) {
        // To later make it easier to update relations
        previousPhoneList = userData.get('phoneContacts') ? userData.get('phoneContacts') : [];
        // Keep archives for further comparisons
        userData.set('phoneContacts', params.phone.contacts);
        hashes.phone = params.phone.hash;
        // Create and delete external contacts relations
        promises.push(updateRelations('phone', userData, previousPhoneList, params.phone.contacts));
      }

      if (params.facebook && _.isArray(params.facebook.contacts) && _.isString(params.facebook.hash)) {
        // To later make it easier to update relations
        previousFacebookList = userData.get('facebookContacts') ? userData.get('facebookContacts') : [];
        // Keep archives for further comparisons
        userData.set('facebookContacts', params.facebook.contacts);
        hashes.facebook = params.facebook.hash;
        // Create and delete external contacts relations
        promises.push(updateRelations('facebook', userData, previousFacebookList, params.facebook.contacts));
      }

      userData.set('contactsHash', hashes);

      return Parse.Promise.when(promises).then(function() {
        return userData.save();
      });
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
        promises.push(updateRelations('phone', userData, [], params.phone.contacts));
      }
      if (params.facebook && _.isArray(params.facebook.contacts) && _.isString(params.facebook.hash)) {
        udObject.facebookContacts = params.facebook.contacts;
        newHashes.facebook = params.facebook.hash;
        promises.push(updateRelations('facebook', userData, [], params.facebook.contacts));
      }
      udObject.contactsHash = newHashes;

      return Parse.Promise.when(promises).then(function() {
        return newUserData.save(udObject);
      });
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
    queryFacebook.exists('phoneNumber'); // Don't return users without phone (= not completed registration)

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
    return Parse.Promise.as(1); // Resolve anyway to avoid breaking the following scripts
  });
}

/**
 * Relations
 */
function updateRelations(contactType, userData, previousList, newList) {
  var ExternalContact = Parse.Object.extend('ExternalContact'); // Class to create objects
  var externalContacts = userData.relation('externalContacts'); // Parse relation
  var promise = Parse.Promise.as(); // Our running promise that will lead the execution here :)

  console.log('Previous: ' + previousList.length + ' — New: ' + newList.length);

  var newContacts = _.difference(newList, previousList);
  var objectsToAdd = [];

  // ONE - Get existing contacts and return those needing to be created
  var query = new Parse.Query('ExternalContact');
  query.equalTo('type', externalType[contactType]);
  query.containedIn('data', newContacts);
  promise = query.find().then(function(contacts) {
    var existingContacts = [];
    _.each(contacts, function(contact) {
      existingContacts.push(contact.get('data'));
      objectsToAdd.push(contact);
    });
    return Parse.Promise.as(_.difference(newContacts, existingContacts));
  })
  // TWO — Create missing contacts
  .then(function(contactsToCreate) {
    var missingContacts = [];
    _.each(contactsToCreate, function(contact) {
      var newExternalContact = new ExternalContact();
      newExternalContact.set('data', contact);
      newExternalContact.set('type', externalType[contactType]);
      missingContacts.push(newExternalContact);
    });
    var wait = new Parse.Promise();
    Parse.Object.saveAll(missingContacts, {
      success: function(newObjects) {
        console.log('Created objects: ' + newObjects.length);
        objectsToAdd = _.union(objectsToAdd, newObjects);
        wait.resolve(objectsToAdd);
      },
      error: function(error) {
        wait.resolve(1);
      }
    });
    return wait;
  })
  // THREE — Save relations for new contacts
  .then(function() {
    console.log('To add: ' + objectsToAdd.length);
    if (objectsToAdd.length) {
      externalContacts.add(objectsToAdd)
      return userData.save();
    }
    else {
      return Parse.Promise.as(1);
    }
  })
  // FOUR — Remove relations for contacts not present anymore
  .then(function() {
    var removedContacts = _.difference(previousList, newList);
    var objectsToRemove = [];
    var query2 = new Parse.Query('ExternalContact');
    query2.equalTo('type', externalType[contactType]);
    query2.containedIn('data', removedContacts);
    query2.each(function(contact) {
      objectsToRemove.push(contact);
    })
    .then(function() {
      console.log('To remove: ' + objectsToRemove.length);
      if (objectsToRemove.length) {
        externalContacts.remove(objectsToRemove);
        return userData.save();
      }
    })
  });

  // Return after resolving all promises
  return promise;
}

/**
 * Contacts auto refresh on new user + push new friend
 */
function declareNewUser(newUser) {
  var phoneNumber = newUser.get('phoneNumber');

  // query phone
  var queryPhone = new Parse.Query('UserData');
  queryPhone.equalTo('phoneContacts', phoneNumber); // phoneContacts is an Array, but equalTo will act like a 'containedIn'

  /*
  // query facebook if applicable
  if (facebookId) {
    var queryFacebook = new Parse.Query('UserData');
    queryFacebook.equalTo('facebookContacts', facebookId);
    // prepare query for both phone and facebook matches
    matchingUserData = Parse.Query.or(queryPhone, queryFacebook);
  }
  else {
    matchingUserData = queryPhone;
  }
  */

  // Tells the query to retrieve the user object, not just the reference to it
  queryPhone.include('user');

  // run query and do business
  var usersToNotify = [];
  return queryPhone.each(function(userData) {
    var user = userData.get('user');
    usersToNotify.push(user.get('username'));
    // add to matched user's contacts
    userData.addUnique('sloveContacts', newUser.id);
    return userData.save().then(function() {
      return activities.addActivity({ user: user, type: 'newContact', value: 1, relatedUser: newUser });
    });
  })
  .then(function() {
    // Only prepare push if there is somebody to notify
    if (usersToNotify.length > 0) {
      var firstName = newUser.get('firstName');
      var lastName = newUser.get('lastName');
      var newSlover = firstName && lastName ? firstName + ' ' + lastName : newUser.get('username');
      var pushData = {
        channels: usersToNotify,
        data: {
          alert: 'New slover in your contacts: ' + newSlover + '! ♡',
          sound: 'Assets/Sound/Congratsbuild2.wav',
          newSlover: newSlover
        }
      };
      var pushOptions = {
        success: function() { console.log('Push new friend sent'); },
        error: function(error) { console.error('Push new friend failed'); }
      };
      return Parse.Push.send(pushData, pushOptions);
    }
    else {
      console.log('Nobody to tell the good news :(');
      return Parse.Promise.as(1);
    }
  });
}

// Exporting for use with require()...
module.exports = {
  refreshContacts: refreshContacts,
  declareNewUser: declareNewUser
};

})();
