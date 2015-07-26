
// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define('hello', function(request, response) {
  response.success('Hello world!');
});

/**
 * Twilio test
 */
var twilio = require('twilio')(
  'AC67aa36effde530903ec7d9a2b11b9498',
  '0b508f57260346c4b909d3f4e063c3b3'
);

// Parse Cloud Function
Parse.Cloud.define('sendPhoneCode', function(request, response) {
  var phoneNumber = request.params.phoneNumber;
  var query = new Parse.Query('_User');
  query.equalTo('phoneNumber', phoneNumber);

  query.find().then(function(queryData) {
    if (queryData.length > 0) {
      response.error({ status: 'phone_number_already_used' });
    }
    else {
      var verificationCode = Math.floor(Math.random() * 9999);
      var user = Parse.User.current();
      user.set('phoneVerificationCode', verificationCode.toString());
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
          errorData.status = 'failed_to_send';
          response.error(errorData);
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
