var path = require('path');
var fs = require('fs');

var webpackDevMiddleware = require('webpack-dev-middleware');
var webpack = require('webpack');

var express = require('express');
var send = require('send');

var httpProxy = require('http-proxy');
var proxy = httpProxy.createProxyServer();

var supportsColor = require('supports-color');

var cwd = process.cwd();

var isWebpack = true;
var serverConfigs;
try {
	var webpackConfigPath = path.join(cwd, 'webpack.config');
	var webpackConfig = require(webpackConfigPath);

} catch (e) {
	isWebpack = false;
}

try {
	var serverConfigPath = path.join(cwd, 'devserver.config');
	serverConfigs = require(serverConfigPath);
} catch (e) {
	serverConfigs = {};
}

isWebpack = isWebpack && serverConfigs.useWebpackDevServer

if (isWebpack) {
	var middlewareOptions = {
		stats: {
			cached: false,
			cachedAssets: false,
			colors: supportsColor
		}
	};

	var webpackDevServer = webpackDevMiddleware(webpack(webpackConfig), middlewareOptions);
}

if (!Array.isArray(serverConfigs)) {
	serverConfigs = [serverConfigs];
}

module.exports = serverConfigs.map(function (serverConfig) {
	var devServer = express();

	// use mock data if it exists
	if (serverConfig.mockPath) {
		console.log('Using ' + serverConfig.mockPath + ' for mock data.');
		devServer.use('*', function (req, res, next) {
			var mockPath = path.join(cwd, serverConfig.mockPath, req.originalUrl);

			fs.stat(mockPath, function (err, stat) {
				if (err) {
					fs.stat(mockPath+'.json', function (err, stat) {
						if (err) {
							next();
							return;
						}

						if (stat.isFile()) {
							console.log('serving mock for '+req.originalUrl);
							send(req, mockPath+'.json').pipe(res);
						} else {
							next();
						}
					});
					return;
				}

				if (stat.isFile()) {
					console.log('serving mock for '+req.originalUrl);
					send(req, mockPath).pipe(res);
				} else {
					next();
				}
			});

		});
	}

	if (isWebpack) {
		devServer.use(webpackDevServer);
	}

	if (serverConfig.compressFiles) {
		devServer.use(function (req, res, next) {
      // current code doesn't work if the requested url has GET params (like domain.com/app.js?latest)
      var toBeCompressed = serverConfig.compressFiles.find(function(ext){ return req.url.endsWith(ext); })
      // if file extension is one of serverConfig.compressFiles, we send the [file].gz from hard disk
      if (toBeCompressed) {
        var fileNameOnDisc = '' + req.url + '.gz'
        res.sendFile(fileNameOnDisc, {
          root:     serverConfig.projectRoot,
          dotfiles: 'deny',
          headers: {
            'Content-Encoding': 'gzip',
            'Content-Type':     'application/javascript',
          }
        })
      } else {
        next()
      }
    })
  }

	// use file if exists
	if (serverConfig.publicPaths) {
		var paths = Object.keys(serverConfig.publicPaths);

		paths.forEach(function (path) {
			console.log('Serving static data on ' + path + ' from ' + serverConfig.publicPaths[path]);
			devServer.use(path, express.static(serverConfig.publicPaths[path]));
		});
	}

	// use proxy
	if (serverConfig.proxy) {
		var paths = Object.keys(serverConfig.proxy);

		proxy.on('error', function(e) {
			console.log('Error in proxy!');
			console.error(e);
		});

		paths.forEach(function (path) {
			console.log('proxying ' + path + ' to ' + serverConfig.proxy[path]);
			devServer.all(path, function (req, res, next) {
				var proxyOptions = {
					target: serverConfig.proxy[path]
				};
				proxy.web(req, res, proxyOptions, function (err) {
					console.log(err.message);
					if (!res.headersSent) {
						res.writeHead(502, { 'content-type': 'application/json' });
					}
					res.end(JSON.stringify({ error: 'proxy_error', reason: err.message }));
				}.bind(this));
			});
		});
	}

	if (serverConfig.app) {
		serverConfig.apps = [serverConfig.app];
	}

	var apps = serverConfig.apps || [];

	apps.forEach(function (app) {
		// use app if not SPA
		if (app && typeof  app !== 'string') {
			console.log('Using the specified express app.');
			devServer.use(app);
		}

		// use SPA
		if (app && typeof  app === 'string') {
			console.log('Serving ' +  app + ' as your single page app.');
			if (isWebpack) {
				devServer.get('*', function (req, res, next) {
					req.url =  app;
					webpackDevServer(req, res, next);
				});
			}

			devServer.get('*', function (req, res) {
				send(req,  app).pipe(res);
			});
		}
	});

	devServer.set('port', serverConfig.port || 3000);
	return devServer;
});
