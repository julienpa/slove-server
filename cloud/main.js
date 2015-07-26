
// Use Parse.Cloud.define to define as many cloud functions as you want.
Parse.Cloud.define('slove', function(request, response) {
  response.success('You\'ve been sloved!');
});

/**
 * Twilio
 */
var twilioTestMode = true;

var testSid = 'AC67aa36effde530903ec7d9a2b11b9498';
var testTok = '0b508f57260346c4b909d3f4e063c3b3';
var liveSid = 'AC7848a69b13ee905acf3aa3fc00a32270';
var liveTok = '30d9b2319348852525081e14ce693749';

var twilio = require('twilio')(
  twilioTestMode ? testSid : liveSid,
  twilioTestMode ? testTok : liveTok
);

// Parse Cloud Function
Parse.Cloud.define('sendPhoneCode', function(request, response) {
  var phoneNumber = request.params.phoneNumber;
  var query = new Parse.Query('_User');

  query.equalTo('phoneNumber', phoneNumber);
  query.find().then(function(queryData) {
    if (queryData.length > 0) {
      response.error('phone_number_already_used');
    }
    else {
      var verificationCode = Math.floor(Math.random() * 9999).toString();
      // Ensures that the code is exactly 4 characters long
      if (verificationCode.length > 4) {
        verificationCode = verificationCode.slice(0, 4);
      }
      while (verificationCode.length < 4) {
        verificationCode = '0' + verificationCode;
      }

      // Save the verificationCode for the user who requested the validation
      var user = Parse.User.current();
      user.set('phoneVerificationCode', verificationCode);
      user.save();

      twilio.sendSms({
        From: '+15005550006',
        To: phoneNumber,
        Body: 'Hi from Slove! Your verification code is: ' + verificationCode
      },
      function(errorData, responseData) {
        if (!errorData) {
          responseData.status = 'ok';
          response.success(responseData);
        }
        else {
          response.error('failed_to_send');
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
    response.error({ status: 'code_not_matching' });
  }
});
