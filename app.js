var twilio = require("twilio"),
    util = require('util'),
    mongodb = require('mongodb'),
    express = require("express"),
    _ = require("underscore"),
    Capability = require("./capability"),
    ConnectRedisStore = require('connect-redis')(express),
    RedisStore =  require('socket.io/lib/stores/redis'),
    redis = require('heroku-redis-client');



var ObjectID = mongodb.ObjectID;

var port = process.env.PORT || 8080,
    sessionSecret = process.env.SESSION_SECRET || "fdasfkjlsadfkljsdah";


// Express
var app = express.createServer(
  express.logger(),
  express.static(__dirname + '/public'),
  express.bodyParser(),
  express.cookieParser(),
  express.session({ secret: sessionSecret, store: new ConnectRedisStore({ client: redis.createClient() }) })
);

app.register('.haml', require('hamljs'));


// Socket.io
var io = require('socket.io').listen(app);

io.set('store', new RedisStore({
  redisPub: redis.createClient(),
  redisSub: redis.createClient(),
  redisClient: redis.createClient()
}));


// Twilio
var client = new twilio.Client(process.env.TWILIO_SID,
                               process.env.TWILIO_AUTH_TOKEN,
                               process.env.PRIMARY_DOMAIN, // Eg "politicalscreamingmatch.com"
                              { "express" : app })
autoUri = global.autoUri
autoUri.baseUri = 'http://' + autoUri.hostname + '/' + autoUri.basePath + '/'

var phone = client.getPhoneNumber(process.env.TWILIO_PHONE); // eg "+16179970268"

var dbMethods = {};


// assuming io is the Socket.IO server object
io.configure(function () { 
 io.set("transports", ["xhr-polling"]); 
 io.set('log level', 0);
 io.set("polling duration", 10); 
});


app.get('/',function(req,res) {
  res.render('index.haml', {
    layout:    false,
    req:       req,
    app:       app
  });
});

app.get('/privacy_policy',function(req,res) {
  res.render('privacy_policy.haml', {
    layout:    false
  });
});



var numberToSocket = {};


phone.setup(function() {


  function sendSMS(socket,number) {
    phone.sendSms("+1" + number,"Reply \"y\" to this message from Political Screaming Match to confirm your cell",{},function() {
      console.log("TXT Sent to:" + number);
    });
    numberToSocket[number] = socket;
    socket.set("number",number);
  }

  function findDiscussion(user1,user2) {
    var positions = ["abortion","guns","government","healthcare", "pot", "gay_marriage","bain",'debate1'];

    var diff = [];
    for(var i=0;i<positions.length;i++) {
      var pos = positions[i];
      if(user1.positions[pos] &&
         user2.positions[pos] &&
         user1.positions[pos] != user2.positions[pos]) {
        diff.push(pos);
      }
    }
    return diff[Math.floor(Math.random()*diff.length)];
  }

  function matchUser(user,callback) {
    // given the user, 
    // generate opposite positions
    dbMethods.findMatch(user,function(matchingUser) {
      if(matchingUser) {
        var discussing = findDiscussion(user,matchingUser);
        matchingUser.until = 0;
        matchingUser.availability = 0;
        matchingUser.connected = true;
        matchingUser.discussing = discussing;
        syncUser(matchingUser);
        dbMethods.updateUser(matchingUser,function() {
          user.until = 0;
          user.availability = 0;
          user.connected = true;
          user.discussing = discussing;
          dbMethods.updateUser(user,function() {
            callback(matchingUser,discussing);
          });
        });
      } else {
        callback(null);
      }
    });
  }

  function syncUser(user) {
    var socket = numberToSocket[user.phone];
    if(socket) { socket.emit("sync",user); }
  }

  function setupCall(user1,user2,discussing) {
    var callTo = user1.twilio ? "client:" + user1.phone : user1.phone;
    phone.makeCall(callTo, null, function(call) {
      console.log("Calling: " + callTo);

      call.on('answered', function(callParams, response) {
        response.append(new twilio.Twiml.Say('    Political screaming match here - you are about to be connected to someone talking about: ' + discussing + ', please introduce yourself and have a spirited debate...Ready...3...2...1'));
        var dialing = null

        if(user2.twilio) {
          dialing = new twilio.Twiml.Dial(
            "<Client>" + user2.phone + "</Client>",
            {
             record: true,
             callerId: "617-997-0268"
          })
        } else {
          dialing = new twilio.Twiml.Dial(user2.phone, {
            record: true,
            callerId: "617-997-0268"
          })
        }
        dialing.on("callEnded" ,function(reqParams,callResponse) {
          dbMethods.saveRecording(reqParams,function(data) {
            console.log(data);
          });
          callResponse.append(new twilio.Twiml.Hangup());
          callResponse.send();
        });
        response.append(dialing);
        response.send();
      });

      call.on("ended",function(reqParams,endedResponse) {
        console.log("Call ended");
        endedResponse.append(new twilio.Twiml.Hangup());
        endedResponse.send();
        dbMethods.updateFields(user1,{ connected: false });
        dbMethods.updateFields(user2,{ connected: false });
        syncUser(user1);
        syncUser(user2);
      });
    });
  }

  io.sockets.on('connection',function(socket) {

    socket.on('disconnect',function() {
      socket.get("number",function(err,number) {
        delete numberToSocket[number];
        dbMethods.updateUser({phone: number, until: 0 });
      });
    });


    socket.on('user_create',function(data,fn) {
      data.available = false;
      data.connected = false;
      data.positions = {};
      data.availability = null;
      data.until = 0;
      dbMethods.fetchUser(data,function(user) {
        if(!user.confirmed) {
          sendSMS(socket,user.phone);
        } else {
          numberToSocket[user.phone] = socket;
          socket.set("number",user.phone);
        }
        fn(user);
      });
    });

    socket.on('user_update',function(data,fn) {
      if(data.available) {
        var now = new Date().getTime(); 
        data.available = false;
        data.until = now + data.availability*60*1000;
      }

      // Don't let people auto confirm
      delete data["confirmed"];

      dbMethods.updateUser(data,function(user) {
        matchUser(user,function(matching_user,discussing) {
          if(matching_user) {

            setupCall(user,matching_user,discussing);
          }
          fn(user);
        });
      });
    });

  /*  socket.on("sms",function(num) {
      smsFromNumber(num);
    });
    */
  });

  function smsFromNumber(num) {
    if(numberToSocket[num]) {
      dbMethods.updateUser({ "phone": num,
                             "confirmed" : true, 
                             "connected" : false, 
                             "available" : false }, function(user) {
        numberToSocket[num].emit("sync",user);
      });
    }
  }


  phone.on('incomingSms', function(smsParams, response) {
    console.log("SMS FROM: " + smsParams["From"]);
    var num = smsParams["From"].replace("+1","");
    smsFromNumber(num);
  });


});


app.get("/recs-admin",function(req,res) {
  dbMethods.getRecordings(function(data) {
    res.render('recordings.haml', {
      layout:    false,
      req:       req,
      recordings: data,
      app:       app
    });
  });
});

app.listen(port);


require("mongodb").connect(process.env.MONGOLAB_URI || "mongodb://localhost/callers", 
              {}, function(error,db) {
  db.collection("recordings",function(err,collection) {
    dbMethods.saveRecording = function(data,callback) {
      data.created_at = new Date();
      collection.insert(data,function(err,recording_data) {
        callback(recording_data);
      });
    }

    dbMethods.getRecordings = function(callback) {
      collection.find().sort({ created_at: -1 }).limit(30).toArray(function(error,results) {
        callback(results);
      });
    };
  });
  db.collection('users', function(err, collection){
    dbMethods.findMatch = function(user,callback) {
      var or_search = [];
      _(user.positions).each(function(value,key) {
        value = value == "l" ? "r" : "l"; // swap left and right
        var v = {}
        v["positions." + key] = value;
        or_search.push(v);
      });

      var now = new Date().getTime();
      var search = { "$or" : or_search, "until": { "$gt" : now }};

      collection.findOne(search, function(error,other_user) {
        callback(other_user);
      });

    };

    dbMethods.fetchUser = function(data,callback) {
      if(data.phone == 'twilio') {
        data.phone = mongodb.ObjectID();
        data.twilio = true;
        data.confirmed = true;

        var capability = new Capability(process.env.TWILIO_SID,
                                        process.env.TWILIO_AUTH_TOKEN)
                                        .allowClientIncoming(data.phone);
        data.twilio_token = capability.generateToken();
      }
      collection.findOne({ phone: data.phone }, function(error,user) {
        if(!user) {
          collection.insert(_.extend(data,{ phone: data.phone,
                              confirmed: data.twilio ? true : false,
                              created: new Date(), 
                              calls: 0 }), 
                              function(err, user_data) {
            callback(user_data[0]);
          });
        } else {
          dbMethods.updateUser(data,callback);
        }
      });
    };

    dbMethods.updateFields = function(user,data) {
      data["_id"] = user["_id"];
      dbMethods.updateUser(data);
      _.extend(user,data);
    }

    dbMethods.updateUser= function(data,callback) {
      var search = data._id ? 
                   { _id:  _.isString(data._id) ?  new ObjectID(data._id) : data._id } :
                   { phone: data.phone };
      collection.findOne(search, function(error,user) {
        if(!user) {
          if(callback) callback(null);
        } else {
          delete data["_id"];
          _(user).extend(data);
          collection.save(user, function() { if(callback) callback(user); });
        }
      });
    };

  });
});

process.on('uncaughtException', function(err) {
  console.log("****************Error**********************");
  console.log(err);
  console.log("****************Error**********************");
});

