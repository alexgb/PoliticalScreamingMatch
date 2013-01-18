$(function() {

  var Templates = {};

  var socket = window.socket = io.connect();

  var countdownTimer = null;

  _.templateSettings = {
    evaluate    : /\[\[- ([\s\S]+?)\]\]/g,
    interpolate : /\[\[= ([\s\S]+?)\]\]/g,
    escape: /\[\[ (.+?)\]\]/g
  };
 
  Backbone.Model.prototype.idAttribute = "_id";

  Backbone.sync = function(method,model,options) {
    var url = model.url;
  
    socket.emit(url + "_" + method, 
                model.toJSON(),
                function(data) {
                  options.success(data);
                });
  };

  // Grab the templates
  $("script[type=backbone]").each(function() {
    Templates[this.id] = _.template($(this).html());
  });

  var User = Backbone.Model.extend({
    url: "user"
  });

  var user = window.user = new User();

  socket.on('sync',function(data) {
    console.log("Sync Data");
    user.set(data);
  });

  var AppView = Backbone.View.extend({
    template: Templates['app-view'],

    render: function() {
      $(this.el).empty();
      $(this.el).append(this.template({ model: user.attributes }));

      this.$("#phone").append(new PhoneView().render().el);
      this.$("#buttons").append(new ButtonsView().render().el);
      this.$("#availability").append(new AvailabilityView().render().el);
      this.status = new StatusView();
      this.$("#status").append(this.status.render().el);
      return this;
    }
  });

  var PhoneView = Backbone.View.extend({
    template: Templates['phone-view'],

    events: {
      "click button#set-cell": "savePhone",
      "click button#set-twilio": "saveTwilio"
    },

    initialize: function() {
      _.bindAll(this,"savePhone","render","confirmed");
      user.on('change:phone',this.render);
      user.on('change:confirmed',this.render);
      user.on('change:confirmed',this.confirmed);
      user.on('change:twilio',this.twilio);
    },

    render: function() {
      $(this.el).empty()
                .append(this.template({ model: user.attributes, completed: user.phone }));
      return this;
    },

    confirmed: function() {

      if(user.get("confirmed")) {
        $(window).scrollTo("#buttons", {  duration: 1000 });
      }
    },

    twilio: function() {
      if(user.get("twilio")) {
        Twilio.Device.setup(user.get("twilio_token"));
        Twilio.Device.ready(function (device) {
        });

        Twilio.Device.incoming(function (conn) {
          //console.log("Incoming connection from " + conn.parameters.From);
          conn.accept();
        });
      }
    },

    savePhone: function() {
      var phone =  this.$("input").val();

      phone = phone.replace(/[^0-9a-zA-Z]/g,"");
      if(phone.length != 10) {
        user.set({ phone: phone });
        alert("Please enter a valid 10 digit US phone number");
      } else {
        user.phone = true;
        user.save({ phone: phone });
      }

    },

    saveTwilio: function() {
      user.phone=true;
      user.twilio =true;
      user.save({ phone: "twilio" });
    }


  });

  var ButtonsView = Backbone.View.extend({
    template: Templates['buttons-view'],

    positions: [
        [ "debate1", "The Debate", "Pro-Obama", "Pro-Romney" ]
  //    [ "bain", "Romney's Bain Depature", "It's Important", "It's a distraction" ]
  //    [ "abortion", "Abortion", "Pro-choice", "Pro-life" ]
  //    [ "guns", "America's Gun Laws", "Stronger Gun Control", "Gun Owner Rights" ]
  //    [ "government", "Government Programs", "Social Safety-net", "Personal Responsibility" ],
  //    [ "healthcare", "Obamacare", "Good for Everyone" ,"Making us Socialists" ]
  //    [ "pot", "Marijuana", "Legalize it", "It's the gateway drug" ],
  //    [ "gay_marriage", "Gay Marriage", "For it", "Is Unholy" ]
    ],

    events: {
      "click button": "selectPosition"
    },

    initialize: function() {
      _.bindAll(this,'render',"selectPosition");
      user.on('change:confirmed',this.render);
      user.on('change:positions',this.render);
    },

    selectPosition: function(e) {
      var pos = _.clone(user.get("positions") || {}),
          field = $(e.target).attr("data-position"),
          val = $(e.target).attr("data-value");

      if(pos[field] == val) {
        delete pos[field]
      } else {
        pos[field] = val;
      }
      if(user.get("availability")) {
        user.save("positions",pos);
      } else {
        user.set("positions",pos);
      }
    },

    render: function() {
      $(this.el).empty()
                .append(this.template({ model: user.attributes, positions: this.positions }));
      if(!user.get('confirmed')) {
        $(this.el).addClass('disabled');
        this.$("button").attr('disabled',true);
      } else {
        $(this.el).removeClass('disabled');
        _.each(user.get("positions") || {}, function(value,pos) {
          this.$("button#" + pos + "_" + value).addClass("selected");
        });

      }
      return this;
    }
  });


  var AvailabilityView = Backbone.View.extend({
    template: Templates['availability-view'],
    events: {
      "click button": "selectAvailability"
    },

    initialize: function() {
      _.bindAll(this,'render',"selectAvailability");
      user.on('change:confirmed',this.render);
      user.on('change:positions',this.render);
      user.on('change:availability',this.render);
    },

    selectAvailability: function(e) {
      var availability = parseInt($(e.target).attr("data-value"));
      user.set("available",true);
      user.save("availability",availability);

      clearInterval(countdownTimer);
      appView.status.timeLeft = availability * 60;
      countdownTimer = setInterval(function() {
        appView.status.timeLeft--;
        appView.status.render();
      },1000);

      $(window).scrollTo("#status", {  duration: 1000 });
    },

    render: function() {
      $(this.el).empty()
                .append(this.template({ model: user.attributes }));

      if(!user.get("positions") ||
         _(user.get("positions")).size() == 0 ||
        user.get("confirmed") !== true) {
        this.$("button").attr("disabled",true);
        $(this.el).addClass('disabled');
      } else {
        $(this.el).removeClass('disabled');
      }

      this.$("[data-value=" + user.get("availability") + "]").addClass("selected");
      return this;
    }
  });

  var StatusView = Backbone.View.extend({
    template: Templates['status-view'],
    initialize: function() {
      _.bindAll(this,'render');
      user.on('change:availability',this.render);
      user.on('change:until',this.render);
    },

    render: function() {
      $(this.el).empty()
                .append(this.template({ model: user.attributes }));

      if(user.get("connected")) {
        $("#status-value").text("You are connected on a call about: " + 
                         user.get("discussing"));
        $(this.el).removeClass("hidden");
      } else if(user.get("until") > 0) {
        if(this.timeLeft > 0) {
          $("#status-value").text("Waiting for call: " + this.timeLeft + " seconds");
        } else {
          user.set("availability",0);
          $("#status-value").text("Time ran out, please click on a button to allow another call");
        }
        $(this.el).removeClass("hidden");
      } else {
        $(this.el).addClass("hidden");
      }
      return this;
    }

  });

  var appView = window.appView =  new AppView();
  $("#content").append(appView.render().el);
});
