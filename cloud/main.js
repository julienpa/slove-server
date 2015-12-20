/* global Parse */
/* global console */
(function() {
'use strict';

// Load module dependencies
var _ = require('cloud/lodash.js');
var acl = require('cloud/acl.js');
var levels = require('cloud/levels.js');
var activities = require('cloud/activities.js');

// Constants
var logLevels = {
  info: 1,
  warning: 2,
  error: 3,
  alert: 4
};

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
    var contacts = require('cloud/contacts.js');
    var webhooks = require('cloud/webhooks.js');
    var phoneNumber = request.params.phoneNumber;
    user.set('phoneNumber', phoneNumber);
    user.save()
    .then(function(updatedUser) {
      // Add to slove contacts for people with the new user in their phone/facebook contacts
      return contacts.declareNewPhone(updatedUser);
    })
    .then(function(updatedUser) {
      return webhooks.pushToSlack(updatedUser);
    })
    .then(function() {
      response.success({ status: 'ok' });
    },
    function(error) {
      // Global error handler
      Parse.Cloud.run('addLog', { level: logLevels.error, type: 'func confirmPhoneCode', code: error.code, message: error.message });
      response.error('error_request_failed');
    });
  }
  else {
    response.error('error_codes_dont_match');
  }
});

/**
 * User
 */
Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  // Check if the object was just created
  if (request.object.isNew()) {
    // Set Slove default numbers
    request.object.set('sloveNumber', 1);
    request.object.set('sloveCredit', 1);
    request.object.set('sloveCounter', 0);
    request.object.set('sentSloveTo', {});
  }
  response.success();
});

/**
 * Get all slove contacts for the current logged user
 */
Parse.Cloud.define('getSlovers', function(request, response) {
  var contacts = require('cloud/contacts.js');

  var currentUser = Parse.User.current();

  // Will be used as a promise
  var refresh = Parse.Promise.as();

  // Refresh contact lists if asked
  if (request.params.phone || request.params.facebook) {
    refresh = contacts.refreshContacts(currentUser, request.params);
  }

  // Whether there was a refresh or not, query user's contacts and return it
  var queryData = {};
  refresh.then(function() {
    var queryUd = new Parse.Query('UserData');
    queryUd.select('sloveContacts');
    queryUd.equalTo('user', currentUser);
    return queryUd.first().then(function(userData) {
      queryData.sloveContacts = userData ? userData.get('sloveContacts') : [];
    });
  })
  .then(function() {
    queryData.follows = [];
    var query = new Parse.Query('Follow');
    query.include('to');
    query.equalTo('from', currentUser);
    return query.each(function(follow) {
      var to = follow.get('to');
      if (to) {
        queryData.follows.push(to.id);
      }
    });
  })
  .then(function() {
    // Slover object model
    var sloverModel = {
      objectId: '', username: '', phoneNumber: '', facebookId: '',
      firstName: '', lastName: '', pictureUrl: '', sentSlove: 0
    };

    var contactIds = _.union(queryData.sloveContacts, queryData.follows);

    var query = new Parse.Query(Parse.User);
    query.select(_.keys(sloverModel));
    query.containedIn('objectId', contactIds);
    query.find().then(
      function(results) {
        var slovers = [];
        var slover;
        var sentSloveTo;
        _.each(results, function(user) {
          sentSloveTo = currentUser.get('sentSloveTo');
          slover = _.clone(sloverModel);
          slover.objectId = user.id;
          slover.username = user.get('username');
          slover.phoneNumber = user.get('phoneNumber');
          if (user.get('facebookId')) { slover.facebookId = user.get('facebookId'); }
          if (user.get('firstName')) { slover.firstName = user.get('firstName'); }
          if (user.get('lastName')) { slover.lastName = user.get('lastName'); }
          if (user.get('pictureUrl')) { slover.pictureUrl = user.get('pictureUrl'); }
          if (sentSloveTo[user.id]) { slover.sentSlove = sentSloveTo[user.id]; }
          slovers.push(slover);
        });
        response.success({ slovers: slovers });
      },
      function() {
        response.error('error_request_failed');
      }
    );
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
        // date computation
        var moment = require('cloud/moment.js');
        var dateNextDelivery = moment().utc();
        if (dateNextDelivery.hours() >= 7) {
          dateNextDelivery.add(1, 'd'); // if we are after today's job exec, add 1 day to compute correctly
        }
        dateNextDelivery.set({ 'hour': 7, 'minute': 0, 'second': 0, 'millisecond': 0 });
        var secondsRemaining = dateNextDelivery.diff(moment().utc(), 'seconds');

        // return the error with time until slove delivery
        response.error({ message: 'error_not_enough_slove', secondsRemaining: secondsRemaining });
        return;
      }

      // Create Slove object that will be passed the data and saved
      var Slove = Parse.Object.extend('Slove');
      var slove = new Slove({ ACL: acl.getACL('master') });

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
  var createdAt = request.object.get('createdAt').getTime();
  var updatedAt = request.object.get('updatedAt').getTime();
  // Check if the object was just created (should be `!request.object.existed()` but this isn't working anymore)
  if (createdAt === updatedAt) {
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
              level.setACL(acl.getACL([slover, sloved])); // @todo: remove. Temp fix for existing levels
              return level.save();
            }
          }
        }));
      }
      else if (sentSloveTo[sloved.id] === 1) {
        // First Slove for these two users
        var Level = Parse.Object.extend('Level');
        var level = new Level({ ACL: acl.getACL([slover, sloved]) });
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
      return activities.addActivity({ user: sloved, type: 'slove', value: 1, relatedUser: slover });
    })
    .then(function() {
      // (Sometimes) log execution time at the very end
      // Do it randomly with an arbitrary number to not create too many lines in database
      // Note: the random range should be increased proportionally with user growth
      if (_.random(0, 10) === 3) {
        var timeEnd = _.now();
        return Parse.Cloud.run('addLog', { level: logLevels.info, type: 'afterSave Slove', message: 'Ran in ' + ((timeEnd - timeBegin) / 1000) + ' sec' });
      }
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
  //-> to enable with smart value when needed: query.lessThan('sloveNumber', 5);
  query.limit(500); // Should go up when user arrive, but max is 1000
  query.find().then(function(users) {
    var promises = [];
    _.each(users, function(user) {
      // Save old slove number to send push only if it has changed
      var currentNumber = user.get('sloveNumber');
      var credit = user.get('sloveCredit');
      // Update flags to trigger necessary actions
      var numberUpdated = false; // won't be set to true for 1-1
      var creditIncrease = false; // will be set to true only for credit increase

      // Slove mechanic!
      if (currentNumber <= 0 && credit < 5) {
        credit++;
        numberUpdated = true;
        creditIncrease = true;
      }
      else if (currentNumber === credit && credit > 1) {
        credit--;
        numberUpdated = true;
      }
      else if (currentNumber < credit) {
        numberUpdated = true;
      }

      // Update number and credit fields, but don't save
      user.set('sloveNumber', credit);
      user.set('sloveCredit', credit);

      // Simple save for most slive updates
      if (!creditIncrease && numberUpdated) {
        promises.push(user.save());
      }
      // Save + push notification
      else if (creditIncrease) {
        promises.push(
          user.save().then(function() {
            // Send push
            var pushData = {
              channels: [user.get('username')],
              data: {
                alert: 'You have ' + credit + ' Sloves to send today, don\'t forget to share your love! ♡'
              }
            };
            var pushOptions = {
              success: function() {
                // Push was sent successfully
                counter++;
              },
              error: function(error) {
                Parse.Cloud.run('addLog', { level: logLevels.error, type: 'job deliverDailySloves push', code: error.code, message: error.message });
              }
            };
            return Parse.Push.send(pushData, pushOptions);
          })
        );
      }
    });
    return Parse.Promise.when(promises);
  })
  .then(
    function() {
      // Set the job's success status
      status.message(counter + ' push sent');
      status.success('Job finished successfully, sent ' + counter + ' pushs');
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
    success: function(newFollowedUser) {
      if (!newFollowedUser) {
        response.error('error_username_doesnt_exist');
        return;
      }

      // Check if that follow doesn't already exist, and add it only if it doesn't
      var innerQuery = new Parse.Query('Follow');
      innerQuery.equalTo('from', currentUser);
      innerQuery.equalTo('to', newFollowedUser);
      innerQuery.first().then(function(existingFollow) {
        if (!existingFollow) {
          // Create Relation object that will be passed the data and saved
          var Follow = Parse.Object.extend('Follow');
          var follow = new Follow({ ACL: acl.getACL([currentUser]) });

          // Create the Relation to be saved
          var followData = {
            from: currentUser,
            to: newFollowedUser
          };

          // Saving Relation in database
          follow.save(followData, {
            success: function(savedFollow) {
              response.success({ status: 'ok', newFollow: savedFollow.id });
            },
            error: function(follow, error) {
              // The save failed
              console.error({ newFollowError: error });
              response.error('error_follow_couldnt_be_saved');
            }
          });
        }
        else {
          response.success({ status: 'ok', newFollow: newFollowedUser.id, details: 'already following' });
        }
      },
      function() {
        // Existing follow request failed
        response.error('error_request_failed');
      });
    },
    error: function() {
      response.error('error_request_failed');
    }
  });
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
  query.limit(30);
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
        currentActivity = _.clone(activityObject);
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
      promises.push(activities.addActivity({ user: level.get('user1'), type: 'level', value: levelNumber, relatedUser: level.get('user2') }));
      promises.push(activities.addActivity({ user: level.get('user2'), type: 'level', value: levelNumber, relatedUser: level.get('user1') }));

      // Send push
      var username1 = level.get('user1').get('username');
      var username2 = level.get('user2').get('username');
      var pushData = {
        channels: [username1, username2],
        data: {
          alert: 'Level up!',
          badge: 'Increment',
          sound: 'Assets/Sound/Congratsbuild2.wav',
          levelUp: {
            user1: username1,
            user2: username2
          }
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
          var levelValue = levels.getLevel(level.get('sloveNumber'));
          if (level.get('hasLevelUp') === true) {
            // We remove 1 level to the returned value if hasLevelUp is TRUE
            // This is to ensure that the users won't see the level up in the profile before receiving the push notif
            levelValue--;
          }
          response.success({ status: 'ok', level: levelValue });
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
  var log = new Log({ ACL: acl.getACL('master') });
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
