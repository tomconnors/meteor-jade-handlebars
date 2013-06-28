Package.describe({
  summary: "Write your templates using Handlebars and Jade instead of HTML and Handlebars"
});

Npm.depends({
  jade: "0.27.7",
  StringScanner: "0.0.3"
});

var fs            = Npm.require('fs');
var path          = Npm.require('path');
//var jade          = Npm.require(path.join(process.env.PACKAGE_DIRS, 'jade-handlebars', 'jade'));
//var html_scanner  = Npm.require(path.join(process.env.PACKAGE_DIRS, 'jade-handlebars', 'html_scanner'));
//var StringScanner = Npm.require(path.join(process.env.PACKAGE_DIRS, 'jade-handlebars', 'cjs-string-scanner', 'lib', "StringScanner"));



Package.on_use(function (api) {
  api.use('templating', 'client');
  //api.use('html_scanner', 'server');
});


var html_scanner = {
  // Scan a template file for <head>, <body>, and <template>
  // tags and extract their contents.
  //
  // This is a primitive, regex-based scanner.  It scans
  // top-level tags, which are allowed to have attributes,
  // and ignores top-level HTML comments.

  scan: function (contents, source_name) {
    var rest = contents;
    var index = 0;

    var advance = function(amount) {
      rest = rest.substring(amount);
      index += amount;
    };

    var parseError = function(msg) {
      var lineNumber = contents.substring(0, index).split('\n').length;
      var line = contents.split('\n')[lineNumber - 1];
      var info = "line "+lineNumber+", file "+source_name + "\n" + line;
      return new Error((msg || "Parse error")+" - "+info);
    };

    var results = html_scanner._initResults();

    var rOpenTag = /^((<(template|head|body)\b)|(<!--)|(<!DOCTYPE|{{!)|$)/i;

    while (rest) {
      // skip whitespace first (for better line numbers)
      advance(rest.match(/^\s*/)[0].length);

      var match = rOpenTag.exec(rest);
      if (! match)
        throw parseError(); // unknown text encountered

      var matchToken = match[1];
      var matchTokenTagName =  match[3];
      var matchTokenComment = match[4];
      var matchTokenUnsupported = match[5];

      advance(match.index + match[0].length);

      if (! matchToken)
        break; // matched $ (end of file)
      if (matchTokenComment === '<!--') {
        // top-level HTML comment
        var commentEnd = /--\s*>/.exec(rest);
        if (! commentEnd)
          throw parseError("unclosed HTML comment");
        advance(commentEnd.index + commentEnd[0].length);
        continue;
      }
      if (matchTokenUnsupported) {
        switch (matchTokenUnsupported.toLowerCase()) {
        case '<!doctype':
          throw parseError(
            "Can't set DOCTYPE here.  (Meteor sets <!DOCTYPE html> for you)");
        case '{{!':
          throw new parseError(
            "Can't use '{{! }}' outside a template.  Use '<!-- -->'.");
        }
        throw new parseError();
      }

      // otherwise, a <tag>
      var tagName = matchTokenTagName.toLowerCase();
      var tagAttribs = {}; // bare name -> value dict
      var rTagPart = /^\s*((([a-zA-Z0-9:_-]+)\s*=\s*(["'])(.*?)\4)|(>))/;
      var attr;
      // read attributes
      while ((attr = rTagPart.exec(rest))) {
        var attrToken = attr[1];
        var attrKey = attr[3];
        var attrValue = attr[5];
        advance(attr.index + attr[0].length);
        if (attrToken === '>')
          break;
        // XXX we don't HTML unescape the attribute value
        // (e.g. to allow "abcd&quot;efg") or protect against
        // collisions with methods of tagAttribs (e.g. for
        // a property named toString)
        attrValue = attrValue.match(/^\s*([\s\S]*?)\s*$/)[1]; // trim
        tagAttribs[attrKey] = attrValue;
      }
      if (! attr) // didn't end on '>'
        throw new parseError("Parse error in tag");
      // find </tag>
      var end = (new RegExp('</'+tagName+'\\s*>', 'i')).exec(rest);
      if (! end)
        throw new parseError("unclosed <"+tagName+">");
      var tagContents = rest.slice(0, end.index);
      advance(end.index + end[0].length);

      // act on the tag
      html_scanner._handleTag(results, tagName, tagAttribs, tagContents,
                              parseError);
    }

    return results;
  },

  _initResults: function() {
    var results = {};
    results.head = '';
    results.body = '';
    results.js = '';
    return results;
  },

  _handleTag: function (results, tag, attribs, contents, parseError) {

    // trim the tag contents.
    // this is a courtesy and is also relied on by some unit tests.
    contents = contents.match(/^[ \t\r\n]*([\s\S]*?)[ \t\r\n]*$/)[1];

    // do we have 1 or more attribs?
    var hasAttribs = false;
    for(var k in attribs) {
      if (attribs.hasOwnProperty(k)) {
        hasAttribs = true;
        break;
      }
    }

    if (tag === "head") {
      if (hasAttribs)
        throw parseError("Attributes on <head> not supported");
      results.head += contents;
      return;
    }

    // <body> or <template>
    var code = 'Handlebars.json_ast_to_func(' +
          JSON.stringify(Handlebars.to_json_ast(contents)) + ')';

    if (tag === "template") {
      var name = attribs.name;
      if (! name)
        throw parseError("Template has no 'name' attribute");

      results.js += "Meteor._def_template(" + JSON.stringify(name) + ","
        + code + ");\n";
    } else {
      // <body>
      if (hasAttribs)
        throw parseError("Attributes on <body> not supported");
      results.js += "Meteor.startup(function(){" +
        "document.body.appendChild(Spark.render(" +
        "Meteor._def_template(null," + code + ")));});";
    }
  }
};

// If we are running at bundle time, set module.exports.
// For unit testing in server environment, don't.
// if (typeof module !== 'undefined')
//   module.exports = html_scanner;


function jsonParser(json) {
  // Number fo indentation
  n = 2;
  // Start the loop
  json.forEach(function(root){
    root.child.forEach(function(child){            
      // If line doesn't have HB tag
      if(root.tags.length < 1){
        child.indent = root.indent+n;
      }
      // If line has HB tag and start with HB tag and not comment
      else if(root.tags.length > 0 && root.tags[0].position == 0 && !root.content.match(/^\/\/\-*.*/)) {
          child.indent = root.indent;
      }
      else if(root.tags.length > 0 && root.tags[0].position != 0 && !root.content.match(/^\/\/\-*.*/)) {
          child.indent = root.indent+n;
      }
      // If child has child, recursive call  
      if(child.child.length > 0)
        jsonParser([child]);
    });
  });
  return json;
}

function jsonToContents(json) {
  for(line in json){
    for(attr in json[line]){
        
      if(attr == "content"){
        global.contents_tmp += Array(json[line].indent+1).join(" ") + json[line][attr] + "\n";
      } 
      else if(attr == "child" && typeof(json[line][attr]) == "object") {
          jsonToContents(json[line][attr]);
      }
    }
  }
  return global.contents_tmp;
}


var jadeHandler = function(bundle, source_path, serve_path, where) {


  var jade = Npm.require("jade");
  // var html_scanner = 
  //   Npm.require(path.join(process.env.PACKAGE_DIRS, 'jade-handlebars', 'html_scanner'));
  var StringScanner = Npm.require('StringScanner');

  // Variables
  var lines = [];
  var json = [];
  var handlebarsPattern = /\s*(\{\{.*(?!\{\{)\}\})/;

  // Handlebars hack
  // Read the file content and create JSON
  try{
    // Create the string scanner with the .jade file content
    var ss = new StringScanner(fs.readFileSync(source_path, "utf8"));
    ss.reset();
    // Parse the file content until the end
    while(!ss.endOfString()){
      // Scan content per line
      ss.scan(/^(\ *)(.*)\n+/);

      // Get the indentation of the line
      indent = ss.captures()[0].length;
      // Get the content of the line
      value = ss.captures()[1];

      // Variables for json
      var child = [];
      var tags = []

      // Scan the content of the line to find handlebars tags
      ss_line = new StringScanner(value);  
      ss_line.reset();
      while(ss_line.checkUntil(handlebarsPattern)){
        ss_line.scanUntil(handlebarsPattern);
        tags.push({"position": ss_line.pointer()-ss_line.captures()[0].length, "value": ss_line.captures()[0]});
      }
      // End scan
      ss_line.terminate();

      // Create the JSON for the line
      line = {"indent": indent, "content": value, "tags": tags, "child": child};

      // Find arborescence
      // If the line is root
      if(line.indent == 0){
        // Add to the main JSON
        json.push(line);
      }else{
        // Add the child to the parent
        for(var i=lines.length-1; i >= 0; i--){
          if(lines[i].indent < line.indent){
            lines[i].child.push(line);
            break;
          }
        }  
      }  
      lines.push(line);   
    }
    // End scan
    ss.terminate();
  } catch(err) {
    return bundle.error(err.message);
  }

  // Fix indentation
  json = jsonParser(json);

  // JSON to string
  global.contents_tmp = ""; // used in jsonToContents() function
  contents = jsonToContents(json); 
  
  // Jade parser
  var jade_options = { pretty: true };

  jade.render(contents, jade_options, function(err, html){
    if (err) throw err;
    contents = html;
  });

  // From meteor/templating package
  if (where !== "client")
    return;

  var results = html_scanner.scan(contents.toString('utf8'), source_path);

  if (results.head)
    bundle.add_resource({
      type: "head",
      data: results.head,
      where: where
    });

  if (results.body)
    bundle.add_resource({
      type: "body",
      data: results.body,
      where: where
    });

  if (results.js) {
    var path_part = path.dirname(serve_path);
    if (path_part === '.')
      path_part = '';
    if (path_part.length && path_part !== path.sep)
      path_part = path_part + path.sep;
    var ext = path.extname(source_path);
    var basename = path.basename(serve_path, ext);
    serve_path = path_part + "template." + basename + ".js";

    bundle.add_resource({
      type: "js",
      path: serve_path,
      data: new Buffer(results.js),
      source_file: source_path,
      where: where
    });
  }
};

Package.register_extension("jade", jadeHandler);