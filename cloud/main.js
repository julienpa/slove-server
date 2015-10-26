/* global Parse */
/* global console */
(function() {
'use strict';

// Load module dependencies
var _ = require('cloud/lodash.js');
var levels = require('cloud/levels.js');

// Constants
var logLevels = {
  info: 1,
  warning: 2,
  error: 3,
  alert: 4
};
var masterAcl = new Parse.ACL();
masterAcl.setPublicReadAccess(false);
masterAcl.setPublicWriteAccess(false);

// Use Parse.Cloud.define to define as many cloud functions as you want.
Parse.Cloud.define('slove', function(request, response) {
  response.success('You\'ve been sloved!');
});

/**
 * Phone number confirmation
 */
Parse.Cloud.define('sendPhoneCode', function(request, response) {
  // Twilio (phone confirmation)
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

  // Param and query object
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
  query.exists('phoneNumber'); // check if phoneNumber is set
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

      if (slover.get('sloveNumber') < 1) {
        response.error('error_not_enough_slove');
        return;
      }

      // Create Slove object that will be passed the data and saved
      var Slove = Parse.Object.extend('Slove');
      var slove = new Slove({ ACL: masterAcl });

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
           * Update of the sloveNumber takes place in an afterSave hook
           */
          var pushData = {
            channels: [targetUsername],
            data: {
              alert: '♡ You received a Slove ♡',
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
          // Send the puuush!
          Parse.Push.send(pushData, pushOptions);
        },
        error: function(slove, error) {
          // The save failed.
          // 'error' is a Parse.Error with an error code and message.
          console.error({ sendSloveError: error });
          // Logging
          Parse.Cloud.run('addLog', { level: logLevels.error, type: 'func sendSlove', code: error.code, message: error.message });
          // Sending response
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
 * 1) Updating sloveNumber and sentSloveTo for the slover
 * 2) Check and update level if needed
 * 3) Create activity line for the sloved
 */
Parse.Cloud.afterSave('Slove', function(request) {
  // Check if the object was just created
  if (request.object.existed() === false) {
    var timeBegin = _.now();

    Parse.Cloud.useMasterKey();

    // 1) and 2)
    var slover = request.object.get('slover');
    var sloved = request.object.get('sloved');

    Parse.Promise.when(slover.fetch(), sloved.fetch()).then(function(r, d) {
      var promises = [];

      // 1)
      // Update sloveNumber for slover
      r.increment('sloveNumber', -1);
      r.increment('sloveCounter');
      // Update sentSloveTo list for slover
      var sentSloveTo = r.get('sentSloveTo');
      if (sentSloveTo[sloved.id]) {
        sentSloveTo[sloved.id] += 1;
      }
      else {
        sentSloveTo[sloved.id] = 1;
      }
      r.set('sentSloveTo', sentSloveTo);
      // Save updated user object
      promises.push(r.save());

      // 2)
      // Get sentSloveTo for sloved and compare to slover
      var sentSloveTo2 = d.get('sentSloveTo');
      if (sentSloveTo2[slover.id]) {
        // = sloved already sent to slover

        // Get smallest sentSlove between both, which is the "newNumber" (can be equal to old one)
        var newNumber = sentSloveTo2[slover.id] < sentSloveTo[sloved.id] ? sentSloveTo2[slover.id] : sentSloveTo[sloved.id];

        // Run the query and see if the couple already exist
        promises.push(getLevelQuery(slover, sloved).first().then(function(level) {
          if (!level) {
            console.error('Level not retrieved in afterSave Slove! :(');
            return Parse.Promise.as(1);
          }
          else {
            var oldNumber = level.get('sloveNumber');
            if (oldNumber < newNumber) {
              level.increment('sloveNumber');
              level.set('hasLevelUp', levels.isNewLevel(oldNumber, newNumber));
              return level.save();
            }
          }
        }));
      }
      else if (sentSloveTo[sloved.id] === 1) {
        // First Slove for these two users
        var Level = Parse.Object.extend('Level');
        var level = new Level();
        // Creating level for them
        promises.push(level.save({ user1: slover, user2: sloved, sloveNumber: 0, hasLevelUp: false }));
      }
      else {
        // else, the slover is a stalker and we should do nothing ^^
        promises.push(Parse.Promise.as(1));
      }

      // Will wait for all promises to be fullfilled
      return Parse.Promise.when(promises);
    })
    .then(function() {
      // 3)
      // Add activity
      return addActivity({ user: sloved, type: 'slove', value: 1, relatedUser: slover });
    })
    .then(function() {
      // Log time at the very end
      var timeEnd = _.now();
      return Parse.Cloud.run('addLog', { level: logLevels.info, type: 'as Slove', message: 'Ran in ' + ((timeEnd - timeBegin) / 1000) + ' sec' });
    },
    function(error) {
      // GLOBAL ERROR HANLDER, ONE OF THE PROMISES GOT REJECTED
      console.error('afterSave Slove promise error: (' + error.code + ') ' + error.message);
    });
  }
});

/**
 * Background job meant to be executed every day to give users their daily amount of Sloves
 */
Parse.Cloud.job('deliverDailySloves', function(request, status) {
  // Set up to modify user data
  Parse.Cloud.useMasterKey();
  // Counter of updated users
  var counter = 0;
  // Query for all users (@todo: add timezone management later)
  var query = new Parse.Query(Parse.User);
  query.each(function(user) {
    counter++;
    // Reinit sloveNumber(-Counter, to rename?) based on sloveCredit value
    user.set('sloveNumber', user.get('sloveCredit'));
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
      Parse.Cloud.run('addLog', { level: logLevels.alert, type: 'job dailySloveDistribution', code: error.code, message: error.message });
      status.error('Job encountered an error (' + error.code + ')');
    }
  );
});

/**
 * Background job used to count sloves for each user and update their sloveCounter
 */
Parse.Cloud.job('initSloveCounters', function(request, status) {
  Parse.Cloud.useMasterKey();
  var query = new Parse.Query(Parse.User);
  query.each(function(user) {
    var sloveQuery = new Parse.Query('Slove');
    sloveQuery.equalTo('slover', user);
    return sloveQuery.count().then(function(count) {
      user.set('sloveCounter', count);
      return user.save();
    });
  })
  .then(
    function() {
      // Set the job's success status
      status.success('Job finished successfully');
    },
    function(error) {
      // Set the job's error status
      console.error(error);
      status.error('Job encountered an error (' + error.code + ')');
    }
  );
});

/**
 * User
 */
Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  // Check if the object was just created
  if (request.object.isNew()) {
    // Set Slove default numbers
    request.object.set('sloveNumber', 5);
    request.object.set('sloveCredit', 5);
    request.object.set('sloveCounter', 0);
    request.object.set('sentSloveTo', {});
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
  // Create Date object based on passed param, or create a default object with January 1st 2015
  var dateLastUpdate = request.params.dateLastUpdate ? new Date(request.params.dateLastUpdate) : new Date('2015-01-01');

  // Create query object
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
    activityType: '',
    activityValue: 0,
    relatedUser: '',
    createdAt: '',
    isNew: false
  };
  var currentActivity;
  var relatedUser;

  // Execute query and create result list
  query.find({
    success: function(results) {
      _.each(results, function(activity) {
        // Get related user object fetched through pointer
        relatedUser = activity.get('relatedUser') ? activity.get('relatedUser') : null;

        // Create and populate a sample activity object
        currentActivity = Object.create(activityObject);
        currentActivity.activityType = activity.get('activityType') ? activity.get('activityType') : '';
        currentActivity.activityValue = activity.get('activityValue') ? activity.get('activityValue') : 0;
        currentActivity.relatedUser = relatedUser ? relatedUser.get('username') : '';
        currentActivity.createdAt = activity.createdAt.toISOString();
        currentActivity.isNew = dateLastUpdate < activity.createdAt;

        // Save it to the list that we will return
        activities.push(currentActivity);
      });

      // Send data back
      response.success({ status: 'ok', dateLastUpdate: dateLastUpdate.toISOString(), activities: activities });
    },
    error: function(error) {
      console.error('getActivities failed: ' + error.message + ' (code: ' + error.code + ')');
      response.error('error_request_failed');
    }
  });
});

function addActivity(params) {
  Parse.Cloud.useMasterKey();
  var acl = new Parse.ACL();
  acl.setReadAccess(params.user, true);
  acl.setPublicReadAccess(false);
  var Activity = Parse.Object.extend('Activity');
  var activity = new Activity({ ACL: acl });
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

/**
 * Levels
 */
// Background job used to process latest levelUps between users, send push and create activity
Parse.Cloud.job('processLevels', function(request, status) {
  var timeBegin = _.now(); // in milliseconds

  Parse.Cloud.useMasterKey();

  var levelUpNumber = 0;
  var pushNumber = 0;

  // Get levelUp-ed levels
  var query = new Parse.Query('Level');
  query.include('user1');
  query.include('user2');
  query.equalTo('hasLevelUp', true);
  query.find().then(function(levelResults) {
    var promises = [];

    _.each(levelResults, function(level) {
      levelUpNumber++;
      var levelNumber = levels.getLevel(level.get('sloveNumber'));

      // Create activity for both users
      promises.push(addActivity({ user: level.get('user1'), type: 'level', value: levelNumber, relatedUser: level.get('user2') }));
      promises.push(addActivity({ user: level.get('user2'), type: 'level', value: levelNumber, relatedUser: level.get('user1') }));

      // Send push
      var pushData = {
        channels: [level.get('user1').get('username'), level.get('user2').get('username')],
        data: {
          alert: '♡ Level up! ♡',
          badge: 'Increment',
          sound: 'Assets/Sound/Congratsbuild2.wav'
        }
      };
      var pushOptions = {
        success: function() {
          // Push was sent successfully
          pushNumber++;
        },
        error: function(error) {
          Parse.Cloud.run('addLog', { level: logLevels.error, type: 'job processLevels push', code: error.code, message: error.message });
        }
      };
      promises.push(Parse.Push.send(pushData, pushOptions));

      // Reset levelUp status
      level.set('hasLevelUp', false);
      promises.push(level.save());
    });

    return Parse.Promise.when(promises);
  })
  .then(function() {
    // Finishing
    var timeEnd = _.now();
    status.success('Job finished in ' + ((timeEnd - timeBegin) / 1000) + ' sec, with ' + levelUpNumber + ' levelUps and ' + pushNumber + ' successful pushs');
  },
  function(error) {
    // GLOBAL ERROR HANLDER, ONE OF THE PROMISES GOT REJECTED
    console.error('job processLevels promise error: (' + error.code + ') ' + error.message);
    Parse.Cloud.run('addLog', { level: logLevels.error, type: 'job processLevels promise', code: error.code, message: error.message });
    status.error('Job error: ' + error.code);
  });
});

// Function to get level between 2 users
Parse.Cloud.define('getLevel', function(request, response) {
  // Logged user
  var user1 = Parse.User.current();
  // Get relation user
  var query = new Parse.Query(Parse.User);
  query.equalTo('username', request.params.username);
  query.first().then(function(user2) {
    if (!user2) {
      response.error('user_not_found');
    }
    // Get level (or not if doesn't exist) and send it back
    getLevelQuery(user1, user2).first({
      success: function(level) {
        if (!level) {
          // Users don't have a level yet
          response.success({ status: 'ok', level: 0 });
        }
        else {
          response.success({ status: 'ok', level: levels.getLevel(level.get('sloveNumber')) });
        }
      },
      error: function(error) {
        Parse.Cloud.run('addLog', { level: logLevels.error, type: 'func getLevel level', code: error.code, message: error.message });
        response.error('error_request_failed');
      }
    });
  },
  function(error) {
    Parse.Cloud.run('addLog', { level: logLevels.error, type: 'func getLevel user', code: error.code, message: error.message });
    response.error('error_request_failed');
  });
});

function getLevelQuery(user1, user2) {
  // user1-user2
  var level12 = new Parse.Query('Level');
  level12.equalTo('user1', user1).equalTo('user2', user2);
  // user2-user1
  var level21 = new Parse.Query('Level');
  level21.equalTo('user1', user2).equalTo('user2', user1);
  // return query object
  return Parse.Query.or(level12, level21);
}

/**
 * Logs
 */
Parse.Cloud.define('addLog', function(request, response) {
  Parse.Cloud.useMasterKey();
  var Log = Parse.Object.extend('Log');
  var log = new Log({ ACL: masterAcl });
  var logData = {
    level: request.params.level,
    type: request.params.type,
    code: request.params.code ? request.params.code : 0,
    message: request.params.message
  };
  log.save(logData, {
    success: function(log) {
      response.success('Log saved successfully: ' + log.id);
    },
    error: function(log, error) {
      console.error({ saveLogError: error });
      response.error('Failed to save Log');
    }
  });
});

})();
