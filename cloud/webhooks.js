/* global Parse */
/* global console */
/* global module */
(function() {
'use strict';

var moment = require('cloud/moment.js');

function pushToSlack(user) {
  // Default to public Slove avatar
  var avatarUrl = user.get('pictureUrl') ? user.get('pictureUrl') : 'https://secure.gravatar.com/avatar/def478f95e7ad36403fb8283514dc11a?s=200';
  var body = {
    username: 'New Slove user at ' + moment().utc().format('X'),
    text: 'Username: ' + user.get('username'),
    icon_url: avatarUrl
  };
  var url = 'https://hooks.slack.com/services/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';

  return send(url, body);
}

function send(url, body) {
  return Parse.Cloud.httpRequest({
    method: 'POST',
    url: url,
    body: body,
    headers: {
      'Content-Type': 'application/json;charset=utf-8'
    }
  })
  .then(function(httpResponse) {
    console.log('Webhook success: ' + httpResponse.text);
  })
  .fail(function() {
    // Resolve anyway to no block the following code
    return Parse.Promise.as(1);
  });
}

// Exporting for use with require()...
module.exports = {
  pushToSlack: pushToSlack
};

})();
