/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Wrapper for built-in http.js to emulate the browser XMLHttpRequest object.
 *
 * This can be used with JS designed for browsers to improve reuse of code and
 * allow the use of existing libraries.
 *
 * Usage: include("XMLHttpRequest.js") and use XMLHttpRequest per W3C specs.
 *
 * @author Dan DeFelippi <dan@driverdan.com>
 * @contributor David Ellis <d.f.ellis@ieee.org>
 * @license MIT
 */

import Url from "url";
import http from "http";
import https from "https";
const spawn = require("child_process").spawn;
const fs = require("fs");

export function XMLHttpRequest(this: any) {
  "use strict";

  /**
   * Private variables
   */
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  //    const http = require("http");
  //    const https = require("https");

  // Holds http.js objects
  let request: Record<string, any> | null;
  let response: Record<string, any>;

  // Request settings
  let settings: Record<string, any> = {};

  // Disable header blacklist.
  // Not part of XHR specs.
  let disableHeaderCheck = false;

  // Set some default headers
  const defaultHeaders: Record<string, string> = {
    "User-Agent": "node-XMLHttpRequest",
    Accept: "*/*",
  };

  let headers: Record<string, string | number> = {};
  const headersCase: Record<string, string> = {};

  // These headers are not user setable.
  // The following are allowed but banned in the spec:
  // * user-agent
  const forbiddenRequestHeaders = [
    "accept-charset",
    "accept-encoding",
    "access-control-request-headers",
    "access-control-request-method",
    "connection",
    "content-length",
    "content-transfer-encoding",
    "cookie",
    "cookie2",
    "date",
    "expect",
    "host",
    "keep-alive",
    "origin",
    "referer",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "via",
  ];

  // These request methods are not allowed
  const forbiddenRequestMethods = ["TRACE", "TRACK", "CONNECT"];

  // Send flag
  let sendFlag = false;
  // Error flag, used when errors occur or abort is called
  let errorFlag = false;

  // Event listeners
  const listeners: Record<string, any> = {};

  /**
   * Constants
   */

  this.UNSENT = 0;
  this.OPENED = 1;
  this.HEADERS_RECEIVED = 2;
  this.LOADING = 3;
  this.DONE = 4;

  /**
   * Public vars
   */

  // Current state
  this.readyState = this.UNSENT;

  // default ready state change handler in case one is not set or is set late
  this.onreadystatechange = null;

  // Result & response
  this.responseText = "";
  this.responseXML = "";
  this.status = null;
  this.statusText = null;

  // Whether cross-site Access-Control requests should be made using
  // credentials such as cookies or authorization headers
  this.withCredentials = false;

  /**
   * Private methods
   */

  /**
   * Check if the specified header is allowed.
   *
   * @param string header Header to validate
   * @return boolean False if not allowed, otherwise true
   */
  const isAllowedHttpHeader = function (header: string) {
    return (
      disableHeaderCheck || (header && forbiddenRequestHeaders.indexOf(header.toLowerCase()) === -1)
    );
  };

  /**
   * Check if the specified method is allowed.
   *
   * @param string method Request method to validate
   * @return boolean False if not allowed, otherwise true
   */
  const isAllowedHttpMethod = function (method: string) {
    return method && forbiddenRequestMethods.indexOf(method) === -1;
  };

  /**
   * Public methods
   */

  /**
   * Open the connection. Currently supports local server requests.
   *
   * @param string method Connection method (eg GET, POST)
   * @param string url URL for the connection.
   * @param boolean async Asynchronous connection. Default is true.
   * @param string user Username for basic authentication (optional)
   * @param string password Password for basic authentication (optional)
   */
  this.open = function (
    method: string,
    url: string,
    async: boolean,
    user: string,
    password: string,
  ) {
    //  this.abort();
    errorFlag = false;

    // Check for valid request method
    if (!isAllowedHttpMethod(method)) {
      throw new Error("SecurityError: Request method not allowed");
    }

    settings = {
      method,
      url: url.toString(),
      async: typeof async !== "boolean" ? true : async,
      user: user || null,
      password: password || null,
    };

    setState(this.OPENED);
  };

  /**
   * Disables or enables isAllowedHttpHeader() check the request. Enabled by default.
   * This does not conform to the W3C spec.
   *
   * @param boolean state Enable or disable header checking.
   */
  this.setDisableHeaderCheck = function (state: boolean) {
    disableHeaderCheck = state;
  };

  /**
   * Sets a header for the request or appends the value if one is already set.
   *
   * @param string header Header name
   * @param string value Header value
   */
  this.setRequestHeader = function (header: string, value: string) {
    if (this.readyState !== this.OPENED) {
      throw new Error("INVALID_STATE_ERR: setRequestHeader can only be called when state is OPEN");
    }
    if (!isAllowedHttpHeader(header)) {
      console.warn('Refused to set unsafe header "' + header + '"');
      return;
    }
    if (sendFlag) {
      throw new Error("INVALID_STATE_ERR: send flag is true");
    }
    header = headersCase[header.toLowerCase()] || header;
    headersCase[header.toLowerCase()] = header;
    headers[header] = headers[header] ? headers[header] + ", " + value : value;
  };

  /**
   * Gets a header from the server response.
   *
   * @param string header Name of header to get.
   * @return string Text of the header or null if it doesn't exist.
   */
  this.getResponseHeader = function (header: string) {
    if (
      typeof header === "string" &&
      this.readyState > this.OPENED &&
      response &&
      response.headers &&
      response.headers[header.toLowerCase()] &&
      !errorFlag
    ) {
      return response.headers[header.toLowerCase()];
    }

    return null;
  };

  /**
   * Gets all the response headers.
   *
   * @return string A string with all response headers separated by CR+LF
   */
  this.getAllResponseHeaders = function () {
    if (this.readyState < this.HEADERS_RECEIVED || errorFlag) {
      return "";
    }
    let result = "";

    for (const i in response.headers) {
      // Cookie headers are excluded
      if (i !== "set-cookie" && i !== "set-cookie2") {
        result += i + ": " + response.headers[i] + "\r\n";
      } else {
        if (Array.isArray(i)) {
          i.forEach((cookie) => {
            result += cookie + ": " + response.headers[i] + "\r\n";
          });
        } else {
          result += i + ": " + response.headers[i] + "\r\n";
        }
      }
    }
    return result.substring(0, result.length - 2);
  };

  /**
   * Gets a request header
   *
   * @param string name Name of header to get
   * @return string Returns the request header or empty string if not set
   */
  this.getRequestHeader = function (name: string) {
    if (typeof name === "string" && headersCase[name.toLowerCase()]) {
      return headers[headersCase[name.toLowerCase()]];
    }

    return "";
  };

  /**
   * Sends the request to the server.
   *
   * @param string data Optional data to send as request body.
   */
  this.send = function (data: string | null) {
    if (this.readyState !== this.OPENED) {
      throw new Error("INVALID_STATE_ERR: connection must be opened before send() is called");
    }

    if (sendFlag) {
      throw new Error("INVALID_STATE_ERR: send has already been called");
    }

    let ssl = false;
    let local = false;
    // eslint-disable-next-line n/no-deprecated-api
    const url = new Url.URL(settings.url);
    let host = "";
    // Determine the server
    switch (url.protocol) {
      case "https:":
        ssl = true;
        break;
      // SSL & non-SSL both need host, no break here.
      case "http:":
        host = url.hostname;
        break;

      case "file:":
        local = true;
        break;

      case undefined:
      case null:
      case "":
        host = "localhost";
        break;

      default:
        throw new Error("Protocol not supported.");
    }

    // Load files off the local filesystem (file://)
    if (local) {
      if (settings.method !== "GET") {
        throw new Error("XMLHttpRequest: Only GET method is supported");
      }

      if (settings.async) {
        fs.readFile(url.pathname, "utf8", function (error: any, data: any) {
          if (error) {
            self.handleError(error);
          } else {
            self.status = 200;
            self.responseText = data;
            setState(self.DONE);
          }
        });
      } else {
        try {
          this.responseText = fs.readFileSync(url.pathname, "utf8");
          this.status = 200;
          setState(self.DONE);
        } catch (e) {
          this.handleError(e);
        }
      }

      return;
    }

    // Default to port 80. If accessing localhost on another port be sure
    // to use http://localhost:port/path
    const port = url.port || (ssl ? 443 : 80);
    // Add query string if one is used
    const uri = url.pathname + (url.search ? url.search : "");

    // Set the defaults if they haven't been set
    for (const name in defaultHeaders) {
      if (!headersCase[name.toLowerCase()]) {
        headers[name] = defaultHeaders[name];
      }
    }

    // Set the Host header or the server may reject the request
    headers.Host = host;
    if (!((ssl && port === 443) || port === 80)) {
      headers.Host += ":" + url.port;
    }

    // Set Basic Auth if necessary
    if (settings.user) {
      if (typeof settings.password === "undefined") {
        settings.password = "";
      }
      const authBuf = Buffer.from(settings.user + ":" + settings.password);
      headers.Authorization = "Basic " + authBuf.toString("base64");
    }

    // Set content length header
    if (settings.method === "GET" || settings.method === "HEAD") {
      data = null;
    } else if (data) {
      headers["Content-Length"] = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);

      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "text/plain;charset=UTF-8";
      }
    } else if (settings.method === "POST") {
      // For a post with no data set Content-Length: 0.
      // This is required by buggy servers that don't meet the specs.
      headers["Content-Length"] = 0;
    }

    const options = {
      host,
      port,
      path: uri,
      method: settings.method,
      headers,
      agent: false,
      withCredentials: self.withCredentials,
    };

    // Reset error flag
    errorFlag = false;

    // Handle async requests
    if (settings.async) {
      // Use the proper protocol
      const doRequest = ssl ? https.request : http.request;

      // Request is being sent, set send flag
      sendFlag = true;

      // As per spec, this is called here for historical reasons.
      self.dispatchEvent("readystatechange");

      // Handler for the response
      const responseHandler = function responseHandler(resp: any) {
        // Set response var to the response we got back
        // This is so it remains accessable outside this scope
        response = resp;
        // Check for redirect
        // @TODO Prevent looped redirects
        if (
          response.statusCode === 301 ||
          response.statusCode === 302 ||
          response.statusCode === 303 ||
          response.statusCode === 307
        ) {
          // Change URL to the redirect location
          settings.url = response.headers.location;
          const url = new Url.URL(settings.url);
          // Set host var in case it's used later
          host = url.hostname;
          // Options for the new request
          const newOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: response.statusCode === 303 ? "GET" : settings.method,
            headers,
            withCredentials: self.withCredentials,
          };

          // Issue the new request
          request = doRequest(newOptions, responseHandler).on("error", errorHandler);
          request?.end();
          // @TODO Check if an XHR event needs to be fired here
          return;
        }

        response.setEncoding("utf8");

        setState(self.HEADERS_RECEIVED);
        self.status = response.statusCode;

        response.on("data", function (chunk: any) {
          // Make sure there's some data
          if (chunk) {
            self.responseText += chunk;
          }
          // Don't emit state changes if the connection has been aborted.
          if (sendFlag) {
            setState(self.LOADING);
          }
        });

        response.on("end", function () {
          if (sendFlag) {
            // Discard the end event if the connection has been aborted
            setState(self.DONE);
            sendFlag = false;
          }
        });

        response.on("error", function (error: any) {
          self.handleError(error);
        });
      };

      // Error handler for the request
      const errorHandler = function errorHandler(error: any) {
        self.handleError(error);
      };

      // Create the request
      request = doRequest(options, responseHandler).on("error", errorHandler);

      // Node 0.4 and later won't accept empty data. Make sure it's needed.
      if (data) {
        request?.write(data);
      }

      request?.end();

      self.dispatchEvent("loadstart");
    } else {
      // Synchronous
      // Create a temporary file for communication with the other Node process
      const contentFile = ".node-xmlhttprequest-content-" + process.pid;
      const syncFile = ".node-xmlhttprequest-sync-" + process.pid;
      fs.writeFileSync(syncFile, "", "utf8");
      // The async request the other Node process executes
      const execString =
        "var http = require('http'), https = require('https'), fs = require('fs');" +
        "var doRequest = http" +
        (ssl ? "s" : "") +
        ".request;" +
        "var options = " +
        JSON.stringify(options) +
        ";" +
        "var responseText = '';" +
        "var req = doRequest(options, function(response) {" +
        "response.setEncoding('utf8');" +
        "response.on('data', function(chunk) {" +
        "  responseText += chunk;" +
        "});" +
        "response.on('end', function() {" +
        "fs.writeFileSync('" +
        contentFile +
        "', JSON.stringify({err: null, data: {statusCode: response.statusCode, headers: response.headers, text: responseText}}), 'utf8');" +
        "fs.unlinkSync('" +
        syncFile +
        "');" +
        "});" +
        "response.on('error', function(error) {" +
        "fs.writeFileSync('" +
        contentFile +
        "', JSON.stringify({err: error}), 'utf8');" +
        "fs.unlinkSync('" +
        syncFile +
        "');" +
        "});" +
        "}).on('error', function(error) {" +
        "fs.writeFileSync('" +
        contentFile +
        "', JSON.stringify({err: error}), 'utf8');" +
        "fs.unlinkSync('" +
        syncFile +
        "');" +
        "});" +
        (data
          ? "req.write('" + JSON.stringify(data).slice(1, -1).replace(/'/g, "\\'") + "');"
          : "") +
        "req.end();";
      // Start the other Node Process, executing this string
      const syncProc = spawn(process.argv[0], ["-e", execString]);
      while (fs.existsSync(syncFile)) {
        // Wait while the sync file is empty
      }
      const resp = JSON.parse(fs.readFileSync(contentFile, "utf8"));
      // Kill the child process once the file has data
      syncProc.stdin.end();
      // Remove the temporary file
      fs.unlinkSync(contentFile);

      if (resp.err) {
        self.handleError(resp.err);
      } else {
        response = resp.data;
        self.status = resp.data.statusCode;
        self.responseText = resp.data.text;
        setState(self.DONE);
      }
    }
  };

  /**
   * Called when an error is encountered to deal with it.
   */
  this.handleError = function (error: any) {
    this.status = 0;
    this.statusText = error;
    this.responseText = error.stack;
    errorFlag = true;
    setState(this.DONE);
    this.dispatchEvent("error");
  };

  /**
   * Aborts a request.
   */
  this.abort = function () {
    if (request) {
      request.abort();
      request = null;
    }

    headers = defaultHeaders;
    this.status = 0;
    this.responseText = "";
    this.responseXML = "";

    errorFlag = true;

    if (
      this.readyState !== this.UNSENT &&
      (this.readyState !== this.OPENED || sendFlag) &&
      this.readyState !== this.DONE
    ) {
      sendFlag = false;
      setState(this.DONE);
    }
    this.readyState = this.UNSENT;
    this.dispatchEvent("abort");
  };

  /**
   * Adds an event listener. Preferred method of binding to events.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  this.addEventListener = function (event: string, callback: Function) {
    if (!(event in listeners)) {
      listeners[event] = [];
    }
    // Currently allows duplicate callbacks. Should it?
    listeners[event].push(callback);
  };

  /**
   * Remove an event callback that has already been bound.
   * Only works on the matching funciton, cannot be a copy.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  this.removeEventListener = function (event: string, callback: Function) {
    if (event in listeners) {
      // Filter will return a new array with the callback removed
      // eslint-disable-next-line @typescript-eslint/ban-types
      listeners[event] = listeners[event].filter(function (ev: Function) {
        return ev !== callback;
      });
    }
  };

  /**
   * Dispatch any events, including both "on" methods and events attached using addEventListener.
   */
  this.dispatchEvent = function (event: string) {
    if (typeof self["on" + event] === "function") {
      self["on" + event]();
    }
    if (event in listeners) {
      for (let i = 0, len = listeners[event].length; i < len; i++) {
        listeners[event][i](self);
      }
    }
  };

  /**
   * Changes readyState and calls onreadystatechange.
   *
   * @param int state New state
   */
  const setState = function (state: number) {
    if (state === self.LOADING || self.readyState !== state) {
      self.readyState = state;

      if (settings.async || self.readyState < self.OPENED || self.readyState === self.DONE) {
        self.dispatchEvent("readystatechange");
      }

      if (self.readyState === self.DONE && !errorFlag) {
        self.dispatchEvent("load");
        // @TODO figure out InspectorInstrumentation::didLoadXHR(cookie)
        self.dispatchEvent("loadend");
      }
    }
  };
}
