var config = require("./config");
var casper = require("casper").create({
  clientScripts: ["./jquery.min.js"]
});
var OAuth = require("oauth-1.0a");
var jsSHA = require("jssha");
var moment = require("moment");

var oauth = OAuth({
  consumer: {
    key: config.twitter.consumerKey,
    secret: config.twitter.consumerSecret
  },
  signature_method: "HMAC-SHA1",
  hash_function: function(base_string, key) {
    var shaObj = new jsSHA("SHA-1", "TEXT");
    shaObj.setHMACKey(key, "TEXT");
    shaObj.update(base_string);
    return shaObj.getHMAC("B64");
  }
});
var url =
  "https://www.dmv.ca.gov/wasapp/foa/clear.do?goTo=officeVisit&localeName=en";
var accountSid = config.twilio.accountSid;
var serviceSid = config.twilio.serviceSid;
var authToken = config.twilio.authToken;
var toNumber = config.twilio.toNumber;
var fromNumber = config.twilio.fromNumber;
var twilioLinked =
  accountSid && serviceSid && authToken && toNumber && fromNumber;
var twitterLinked =
  config.twitter.accessToken &&
  config.twitter.accessTokenSecret &&
  config.twitter.consumerKey &&
  config.twitter.consumerSecret;
var providedDay;
var notify;

function CasperException(message, stack) {
  this.name = "CasperException";
  this.message = message;
  this.stack = stack;
}

casper.on("error", function(msg, backtrace) {
  this.echo("Exception: " + msg + backtrace);
  this.capture("./out/error.png");
  throw new CasperException(msg, backtrace);
});

casper.on("remote.message", function(msg) {
  this.echo("remote console.log:" + msg);
});

casper.start(url);

casper.then(function() {
  this.echo("Landed on page: " + this.getTitle());
});

casper.then(function() {
  this.echo("Filling out dmv form...");
  this.evaluate(
    function(l, fn, ln, ac, tp, ts) {
      $("#officeId").val(l);
      $("#one_task").click();
      $("#taskRID").click();
      $("#first_name").val(fn);
      $("#last_name").val(ln);
      $("#areaCode").val(ac);
      $("#telPrefix").val(tp);
      $("#telSuffix").val(ts);
    },
    config.locationId,
    config.firstName,
    config.lastName,
    config.areaCode,
    config.telPrefix,
    config.telSuffix
  );
});

casper.then(function() {
  this.echo("Clicking on continue...");
  this.evaluate(function() {
    $('input[type="submit"]').click();
  });
});

casper.then(function() {
  this.echo("Waiting for appointment table...");
  this.waitForSelector('td[data-title="Appointment"]');
});

casper.then(function() {
  this.echo("Landed on page: " + this.getTitle());
  this.echo("Looking for earliest time...");
  providedDay = this.evaluate(function() {
    var dt = $('td[data-title="Appointment"] strong').text();
    console.log($('td[data-title="Appointment"]').text());
    return dt;
  });
});

casper.then(function() {
  this.echo("Date found: " + providedDay);

  var appointmentTime = moment(providedDay, "dddd, MMMM D, YYYY at h:mm A");
  var today = moment();
  var numDays = appointmentTime.diff(today, "days");
  this.echo("Number of days away: " + numDays);

  if (numDays < config.threshold) {
    notify = true;
    this.echo("New appointment slot available within threshold");
  } else {
    notify = false;
    this.echo("No appointment slots available within threshold");
  }
});

casper.then(function() {
  if (twilioLinked && notify) {
    this.echo("Sending twilio request...");
    this.open(
      "https://" +
        accountSid +
        ":" +
        authToken +
        "@" +
        "api.twilio.com/2010-04-01/Accounts/" +
        accountSid +
        "/Messages",
      {
        method: "post",
        data: {
          To: toNumber,
          From: fromNumber,
          Body: "New appointment slot open: " + providedDay,
          MessagingServiceSid: serviceSid
        }
      }
    ).then(function() {
      require("utils").dump(this.getPageContent());
    });
  }
});

casper.then(function() {
  if (twitterLinked && notify) {
    this.echo("Sending twitter request...");
    var message = "New appointment slot open: " + providedDay;
    var requestData = {
      url: "https://api.twitter.com/1.1/statuses/update.json",
      method: "POST",
      data: {
        status: message
      }
    };
    var token = {
      key: config.twitter.accessToken,
      secret: config.twitter.accessTokenSecret
    };
    this.open(requestData.url, {
      method: requestData.method,
      data: requestData.data,
      headers: oauth.toHeader(oauth.authorize(requestData, token))
    });
  }
});

casper.run(function() {
  this.echo("Done");
  this.exit();
});
