/* global Parse */
/* global console */
(function() {
'use strict';

// Load module dependencies
var _ = require('underscore');

// Use Parse.Cloud.define to define as many cloud functions as you want.
Parse.Cloud.define('slove', function(request, response) {
  response.success('You\'ve been sloved!');
});

/**
 * Twilio (phone confirmation)
 */
var twilioLiveMode = true;

var testSid = 'AC67aa36effde530903ec7d9a2b11b9498';
var testTok = '0b508f57260346c4b909d3f4e063c3b3';
var liveSid = 'AC7848a69b13ee905acf3aa3fc00a32270';
var liveTok = '30d9b2319348852525081e14ce693749';

var sandboxPin = '9863-5189';
var sandboxPhone = '+33644600124';
var livePhone = '+16466933339';

var twilio = require('twilio')(
  twilioLiveMode ? liveSid : testSid,
  twilioLiveMode ? liveTok : testTok
);

Parse.Cloud.define('sendPhoneCode', function(request, response) {
  var phoneNumber = request.params.phoneNumber;
  var query = new Parse.Query(Parse.User);

  query.equalTo('phoneNumber', phoneNumber);
  query.find().then(function(results) {
    if (results.length > 0) {
      response.error('error_phone_number_already_used');
    }
    else {
      var verificationCode = _.random(1000, 9999).toString();

      // Save the verificationCode for the user who requested the validation
      var user = Parse.User.current();
      user.set('phoneVerificationCode', verificationCode);
      user.save();

      var sms = 'Hi from Slove! Your verification code is: ' + verificationCode;
      twilio.sendSms({
        From: twilioLiveMode ? livePhone : sandboxPhone,
        To: phoneNumber,
        Body: twilioLiveMode ? sms : sandboxPin + ' ' + sms
      },
      function(errorData, responseData) {
        if (!errorData) {
          responseData.status = 'ok';
          response.success(responseData);
        }
        else {
          console.error(errorData);
          response.error('error_failed_to_send');
        }
      });
    }
  });
});

Parse.Cloud.define('confirmPhoneCode', function(request, response) {
  var user = Parse.User.current();
  var verificationCode = user.get('phoneVerificationCode');

  if (verificationCode === request.params.phoneVerificationCode) {
    user.set('phoneNumber', request.params.phoneNumber);
    user.save();
    response.success({ status: 'ok' });
  }
  else {
    response.error('error_codes_dont_match');
  }
});

/**
 * Contacts and Facebook friends
 */
Parse.Cloud.define('getRegisteredContacts', function(request, response) {
  var phoneNumbers = request.params.phoneNumbers;
  // Check if param was sent correctly
  if (phoneNumbers === undefined) {
    response.error('error_missing_param');
    return;
  }
  // Check if param is in the expected format
  if (!Array.isArray(phoneNumbers)) {
    response.error('error_param_is_not_an_array');
    return;
  }

  // Run the query with supplied param and send back formated results,
  // or send an error message if no match was found
  var registeredContacts = [];
  var userObject = {
    username: '',
    phoneNumber: '',
    pictureUrl: ''
  };
  var currentUser;
  var query = new Parse.Query(Parse.User);
  query.containedIn('phoneNumber', phoneNumbers);
  query.each(function(user) {
    currentUser = Object.create(userObject);
    currentUser.username = user.get('username') ? user.get('username') : '';
    currentUser.pictureUrl = user.get('pictureUrl') ? user.get('pictureUrl') : '';
    // We know this one is present because it matched
    currentUser.phoneNumber = user.get('phoneNumber');
    // Save it to the list that we will return
    registeredContacts.push(currentUser);
  })
  .then(function() {
    if (registeredContacts.length > 0) {
      response.success({ status: 'ok', registeredContacts: registeredContacts });
    }
    else {
      response.error('error_no_user_found');
    }
  });
});

Parse.Cloud.define('getRegisteredFriends', function(request, response) {
  var facebookIds = request.params.facebookIds;
  // Check if param was sent correctly
  if (facebookIds === undefined) {
    response.error('error_missing_param');
    return;
  }
  // Check if param is in the expected format
  if (!Array.isArray(facebookIds)) {
    response.error('error_param_is_not_an_array');
    return;
  }

  // Run the query with supplied param and send back formated results,
  // or send an error message if no match was found
  var registeredFriends = [];
  var userObject = {
    username: '',
    facebookId: '',
    pictureUrl: ''
  };
  var currentUser;
  var query = new Parse.Query(Parse.User);
  query.containedIn('facebookId', facebookIds);
  query.each(function(user) {
    currentUser = Object.create(userObject);
    currentUser.username = user.get('username') ? user.get('username') : '';
    currentUser.pictureUrl = user.get('pictureUrl') ? user.get('pictureUrl') : '';
    // We know this one is present because it matched
    currentUser.facebookId = user.get('facebookId');
    // Save it to the list that we will return
    registeredFriends.push(currentUser);
  })
  .then(function() {
    if (registeredFriends.length > 0) {
      response.success({ status: 'ok', registeredFriends: registeredFriends });
    }
    else {
      response.error('error_no_user_found');
    }
  });
});

/**
 * Serious business: send Slove and Push notifs!
 */
Parse.Cloud.define('sendSlove', function(request, response) {
  // Retrieve users
  var slover = Parse.User.current();
  var targetUsername = request.params.username;
  // Retrieve sloved user info
  var query = new Parse.Query(Parse.User);
  query.equalTo('username', targetUsername);
  query.first({
    success: function(target) {
      if (!target) {
        response.error('error_username_doesnt_exist');
        return;
      }

      if (slover.get('sloveCounter') < 1) {
        response.error('error_not_enough_slove');
        return;
      }

      // Create Slove object that will be passed the data and saved
      var Slove = Parse.Object.extend('Slove');
      var slove = new Slove();

      // Create the Slove to be saved
      var sloveData = {
        slover: slover,
        sloved: target
      };

      // Saving Slove in database
      slove.save(sloveData, {
        success: function(savedSlove) {
          console.log({ savedSlove: savedSlove.id });

          /**
           * Slove saved successfully, trying to send Slove push
           * Update of the sloveCounter takes place in an afterSave hook
           */
          var pushData = {
            channels: [targetUsername],
            data: {
              alert: '♥ New Slove from ' + slover.get('username') + ' ♥',
              badge: 'Increment',
              sound: 'Assets/Sound/Congratsbuild2.wav',
              slover: {
                username: slover.get('username'),
                pictureUrl: slover.get('pictureUrl')
              }
            }
          };
          var pushOptions = {
            success: function() {
              // Push was sent successfully
              response.success({ status: 'ok', sloved: targetUsername });
            },
            error: function(error) {
              console.error({ pushError: error });
              response.error('error_push_couldnt_be_sent');
            }
          };
          Parse.Push.send(pushData, pushOptions);
        },
        error: function(slove, error) {
          // The save failed.
          // error is a Parse.Error with an error code and message.
          console.error({ sendSloveError: error });
          response.error('error_slove_couldnt_be_saved');
        }
      });
    },
    error: function() {
      response.error('error_user_request_failed');
    }
  });
});

/**
 * 1) Updating sloveCounter for the slover
 * 2) Setting permissions on the Slove object
 */
Parse.Cloud.afterSave('Slove', function(request) {
  Parse.Cloud.useMasterKey();

  // Check if the object was just created
  if (request.object.existed() === false) {
    // 1)
    // Slover counter update
    request.object.get('slover').fetch().then(function(slover) {
      var sloverCounter = slover.get('sloveCounter');
      slover.set('sloveCounter', sloverCounter - 1);
      slover.save();
    });

    // 2)
    // No public read nor write
    var acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    // Apply ACL to the object and save
    request.object.setACL(acl);
    request.object.save();
  }
});

/**
 * Background job meant to be executed every day to give users their daily amount of Sloves
 */
Parse.Cloud.job('dailySloveDistribution', function(request, status) {
  // Set up to modify user data
  Parse.Cloud.useMasterKey();
  // Counter of updated users
  var counter = 0;
  // Query for all users (@todo: add timezone management later)
  var query = new Parse.Query(Parse.User);
  query.each(function(user) {
    counter++;
    // Reinit sloveNumber(-Counter, to rename?) based on sloveCredit value
    user.set('sloveCounter', user.get('sloveCredit'));
    return user.save();
  })
  .then(
    function() {
      // Set the job's success status
      status.message(counter + ' users processed');
      status.success('Job finished successfully');
    },
    function(error) {
      // Set the job's error status
      console.error(error);
      status.error('Job encountered an error');
    }
  );
});

/**
 * User
 */
Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  // Check if the object was just created
  if (request.object.existed() === false) {
    // Set arbitrary default number. Could be set differently...
    request.object.set('sloveCounter', 5);
    request.object.set('sloveCredit', 5);
  }
  response.success();
});

/**
 * Follows
 */
Parse.Cloud.define('addFollow', function(request, response) {
  // Retrieve users
  var currentUser = Parse.User.current();
  var newFollowUsername = request.params.username;
  // Retrieve newRelation user info
  var query = new Parse.Query(Parse.User);
  query.equalTo('username', newFollowUsername);
  query.first({
    success: function(newFollow) {
      if (!newFollow) {
        response.error('error_username_doesnt_exist');
        return;
      }

      // Create Relation object that will be passed the data and saved
      var Follow = Parse.Object.extend('Follow');
      var follow = new Follow();

      // Create the Relation to be saved
      var followData = {
        from: currentUser,
        to: newFollow
      };

      // Saving Relation in database
      follow.save(followData, {
        success: function(savedFollow) {
          response.success({ status: 'ok', newFollow: savedFollow.id });
        },
        error: function(follow, error) {
          // The save failed.
          // error is a Parse.Error with an error code and message.
          console.error({ newFollowError: error });
          response.error('error_follow_couldnt_be_saved');
        }
      });
    },
    error: function() {
      response.error('error_request_failed');
    }
  });
});

Parse.Cloud.define('getFollows', function(request, response) {
  var query = new Parse.Query('Follow');

  // Tells the query to retrieve the user objects, not just the reference to them
  query.include('to');

  // Add query condition to get only current user's follows
  query.equalTo('from', Parse.User.current());

  // Prepare data
  var follows = [];
  var userObject = {
    username: '',
    pictureUrl: ''
  };
  var currentUser;
  var followedUser;

  // Execute query and loop through results
  query.each(function(follow) {
    followedUser = follow.get('to');
    currentUser = Object.create(userObject);
    currentUser.username = followedUser.get('username') ? followedUser.get('username') : '';
    currentUser.pictureUrl = followedUser.get('pictureUrl') ? followedUser.get('pictureUrl') : '';
    // Save it to the list that we will return
    follows.push(currentUser);
  })
  .then(
    function() {
      response.success({ status: 'ok', follows: follows });
    },
    function() {
      response.error('error_request_failed');
    }
  );
});

/**
 * Activity
 */
Parse.Cloud.define('getActivities', function(request, response) {
  var query = new Parse.Query('Activity');

  // Limit number of activities returned, and order them by date
  query.limit(20);
  query.descending('createdAt');

  // Tells the query to retrieve the relatedUser objects, not just the reference to them
  query.include('relatedUser');

  // Add query condition to get only current user's activity
  query.equalTo('user', Parse.User.current());

  // Prepare data
  var activities = [];
  var activityObject = {
    isNew: false,
    activityType: '',
    activityValue: 0,
    relatedUser: ''
  };
  var currentActivity;
  var relatedUser;

  // Execute query and create result list
  query.find({
    success: function(results) {
      _.each(results, function(activity) {
        // Create and populate a sample activity object
        relatedUser = activity.get('relatedUser') ? activity.get('relatedUser') : null;

        currentActivity = Object.create(activityObject);
        currentActivity.activityType = activity.get('activityType') ? activity.get('activityType') : '';
        currentActivity.activityValue = activity.get('activityValue') ? activity.get('activityValue') : 0;
        currentActivity.relatedUser = relatedUser ? relatedUser.get('username') : '';

        // Save it to the list that we will return
        activities.push(currentActivity);
      });

      // Send data back
      response.success({ status: 'ok', activities: activities });
    },
    error: function(error) {
      console.error('getActivities failed: ' + error.message + ' (code: ' + error.code + ')');
      response.error('error_request_failed');
    }
  });
});

})();
