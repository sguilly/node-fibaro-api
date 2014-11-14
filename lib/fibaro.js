var Q = require('q'),
    http = require('http'),
    request = require('request'),
    async = require('async'),
    util = require('util');

var FibaroClient = module.exports = function(host, user, pass) {
    this.rootUrl = 'http://'+ host +'/api';
    this.username = user;
    this.password = pass;
    this.cookies = request.jar();

    this.optionsRefreshStates = {
        host: host,
        port: 80,
        path: '/api/refreshStates',
        headers: {
            'Authorization': 'Basic ' + new Buffer(this.username + ':' + this.password).toString('base64')
        }
    };

    this.setCredentials = function(user, pass) {
        this.username = user;
        this.password = pass;
    }

    this.call = function(action, params, callback) {
        // If no params was passed
        if(typeof params == 'function') {
            callback = params;
            params = {};
        }

        var reqOptions = {
            'method': 'GET',
            'uri': this.rootUrl +'/'+ action,
            'auth': {
                    'user': this.username,
                    'pass': this.password,
                    'sendImmediately': false
            },
            'jar': this.cookies,
            'qs': params
        };

        var req = request(reqOptions, function(err, res, body) {
            if(err) {
                if('code' in err && err.code == 'ECONNREFUSED') {
                    callback(new Error('Fibaro not running...'));
                } else {
                    callback(err);
                }

            } else if(typeof body == 'object' && 'error' in body) {
                callback(new Error(body.error));

            } else if(res.statusCode != 200 && res.statusCode != 202) { 
                if(res.statusCode == 401) {
                    callback(new AuthError('Bad username or password.'));
                } else {
                    callback(new Error('Fibaro API returned status code : '+ res.statusCode));
                }

            } else {
                try {
                    body = JSON.parse(body);
                } catch (e) {}

                callback(null, body);
            }
        });
    }

    // TODO: put shortcuts in a separate file
    var client = this;
    var shortcuts = this.api = {
        // ---------------------------------------------------------------
        // Rooms
        // ---------------------------------------------------------------
        rooms: {
            list: function(callback) {
                client.call('rooms', callback);
            }
        },

        // ---------------------------------------------------------------
        // Scenes
        // ---------------------------------------------------------------
        scenes: {
            list: function(callback) {
                client.call('scenes', callback);
            }
        },

        // ---------------------------------------------------------------
        // Devices
        // ---------------------------------------------------------------
        devices: {
            list: function(callback) {
                client.call('devices', callback);
            },
            get: function(id, callback) {
                client.call('devices', { 'id': id }, callback);
            },
            turnOn: function(id, callback) {
                client.call('callAction', { 'deviceID': id, 'name': 'turnOn' }, callback);
            },
            turnOff: function(id, callback) {
                client.call('callAction', { 'deviceID': id, 'name': 'turnOff' }, callback);
            },
            toggleValue: function(id, callback) {
                var self = this;
                var newVal = null;

                async.waterfall([
                    function getDeviceStatus(cb) {
                        self.get(id, cb);
                    },

                    function setDeviceStatus(device, cb) {
                        if(device.properties.value == 0) {
                            newVal = 1;
                            self.turnOn(id, cb);
                        } else {
                            newVal = 0;
                            self.turnOff(id, cb);
                        }
                    }
                ], function(err) {
                    callback(err, newVal);
                });
            }
        }
    };

    this.currentOffsetEvents = 1;
    this.lastOffsetEvents = 1;
    this.stopLoop = false;

    this.pullEvents = function()
    {
        console.log('pullEvents');

        var self = this;
        var deferred = Q.defer();

        this.optionsRefreshStates.path = '/api/refreshStates?last='+self.currentOffsetEvents;

        console.log(this.optionsRefreshStates.path);

        var request = http.get(self.optionsRefreshStates, function(res){
            var body = "";
            res.on('data', function(data) {
                body += data;
            });
            res.on('end', function() {



                var data = JSON.parse(body);

                console.log('data');
                console.log(data);

                self.lastOffsetEvents = data.last;

                if(self.currentOffsetEvents<self.lastOffsetEvents)
                {
                    if ((self.lastOffsetEvents-self.currentOffsetEvents)>50)
                    {
                        self.currentOffsetEvents = self.lastOffsetEvents-50;
                    }
                    else
                    {
                        self.currentOffsetEvents ++;
                    }
                }

                if(body.indexOf('alue')>-1)
                {

                    var eventDate = new Date(data.timestamp*1000);

                    console.log(self.currentOffsetEvents+'('+data.last+')'+'> '+eventDate.toISOString()+' >'+JSON.stringify(data.changes));
                }

                if(self.stopLoop === true)
                {
                    console.log('test stopLoop true');
                    console.log(self.stopLoop);
                    deferred.resolve(true);
                }
                else{
                    deferred.resolve();
                }


            });
            res.on('error', function(e) {
                console.log("Got error: " + e.message);

                deferred.reject(error);
            });
        });

        return deferred.promise;
    };

    Q.until = function (fn) {

        return fn().then(function (val) {
            if (val) {
                console.log('fin de la boucle');
                return;
            }

            return Q.until(fn);
        });
    };

    this.subscribe = function () {

        console.log('Start');

        this.stopLoop = false;

        var self = this;

        var d = Q.until(function () {

            console.log('request');
            return Q.delay(250).then(function()
            {
                console.log('dans Q delay');
                return self.pullEvents()
            });
        }).then(function () {
            console.log('then');
        });


        return d.promise;

    }

    this.unsubscribe = function()
    {
        console.log('unsubscribe');
        this.stopLoop = true;
    }
}

FibaroClient.discover = function (callback, timeout) {

    console.log('FibaroClient.discover');

    var re = /^ACK (HC2-[0-9]+) ([0-9a-f:]+)$/;

    var server = require('dgram').createSocket("udp4");

    server.on('message', function (packet, rinfo) {

        console.log('FibaroClient.discover : message');
        console.log(packet.toString());
        console.log(rinfo);

        var matches = re.exec(packet.toString());

        if (matches) {
            callback({
                ip: rinfo.address,
                serial: matches[1],
                mac: matches[2]
            });
        }
    });

    server.bind(44444, function () {
        var message = new Buffer("FIBARO");
        server.setBroadcast(true);
        server.send(message, 0, message.length, 44444, "255.255.255.255");
    });

    setTimeout(function () {
        server.close();
    }, timeout || 5000);
};

/* Custom error objects */
var AbstractError = function (msg, constr) {
  Error.captureStackTrace(this, constr || this)
  this.message = msg || 'Error'
}
util.inherits(AbstractError, Error);
AbstractError.prototype.name = 'Abstract Error';

var AuthError = function (msg) {
  AuthError.super_.call(this, msg, this.constructor)
}
util.inherits(AuthError, AbstractError)
AuthError.prototype.message = 'Authentification Error'
