// Main document
var data = {};
// Name of the current view
var view = 'index';
// Options of the current view
var viewData = {};

// Nonpersistent settings
var settings = {
    benchFilter: {
	improvements: true,
	boring: false,
	regressions: true,
    },
    collapsedGroups: [true, false, false, false]
};

// Routes

indexRoute = crossroads.addRoute('');
completeRoute = crossroads.addRoute('all');
revisionRoute = crossroads.addRoute('revision/{hash}');
graphIndexRoute = crossroads.addRoute('graphs');
graphRoute = crossroads.addRoute('graph/{benchName*}');

function handleChanges(newHash) {
  crossroads.parse(newHash);
}

// Signals

viewChanged = new signals.Signal()
dataChanged = new signals.Signal()


// Data

function commitsFrom(revs, hash, count) {
  // Can happen during loading
  if (!revs) {return []};

  if (count == 0) return [];

  var rev = revs[hash];
  if (rev) {
    if (rev.summary.parents.length > 0) {
      var later = commitsFrom(revs, rev.summary.parents[0], count - 1);
      later.unshift(rev);
      return later;
    } else {
      return [ rev ];
    }
  } else {
    return []
  }
}


// Template handling
var templates = {};

$(function ()  {
  var template_ids =  ["revision", "index", "complete", "graphIndex", "graph", "revTooltip"];
  template_ids.forEach(function(id) {
    var source = $("#" + id).html();
    templates[id] = Handlebars.compile(source);
  });

  var partials_ids =  ["nav", "summary-icons", "summary-list", "nothing"];
  partials_ids.forEach(function(id) {
    var source = $("#" + id).html();
    Handlebars.registerPartial(id, source);
  });

});

Handlebars.registerHelper('revisionLink', function(hash) {
  if (!hash) { return "#"; }
  return "#" + revisionRoute.interpolate({hash:hash});
});
Handlebars.registerHelper('graphLink', function(benchName) {
  return "#" + graphRoute.interpolate({'benchName*':benchName});
});
Handlebars.registerHelper('diffLink', function(rev1, rev2) {
  return data.settings.cgitLink + "/commitdiff/" + rev2
});
Handlebars.registerHelper('logLink', function(rev) {
  return Handlebars.compile(data.settings.logLink)({rev:rev});
});
Handlebars.registerHelper('indexLink', function() {
  return "#" + indexRoute.interpolate();
});
Handlebars.registerHelper('allLink', function() {
  return "#" + completeRoute.interpolate();
});
Handlebars.registerHelper('graphIndexLink', function() {
  return "#" + graphIndexRoute.interpolate();
});
Handlebars.registerHelper('recentCommits', function(revisions) {
  return commitsFrom(revisions, data.latest, data.settings.limitRecent);
});
Handlebars.registerHelper('allCommits', function(revisions) {
  return commitsFrom(revisions, data.latest, -1);
});
function shortRev(rev) {
  if (!rev) { return ''; }
  return rev.substr(0,7);
}
Handlebars.registerHelper('shortRev', shortRev);
Handlebars.registerHelper('iso8601', function(timestamp) {
  if (!timestamp) { return '' };
  return new Date(timestamp*1000).toISOString();	   
});
Handlebars.registerHelper('humanDate', function(timestamp) {
  return new Date(timestamp*1000).toString();
});

// We cache everything
var jsonSeen = {};
function getJSON(url, callback, options) {
    var opts = {
        block: true,
    };
    $.extend(opts, options);
    if (jsonSeen[url]) {
	console.log("Not fetching "+url+" again.");
	if (callback) callback();
    } else {
	console.log("Fetching "+url+".");
        $.ajax(url, {
            success: function (newdata) {
		console.log("Fetched "+url+".");
	        jsonSeen[url] = true;
	        $.extend(true, data, newdata);
	        dataChanged.dispatch();
	        if (callback) callback();
            },
            dataType: 'json'
        });
    }
}


// Views

function groupStats (benchResults) {
  return {
    totalCount: benchResults.length,
    improvementCount: benchResults.filter(function (br) { return br.changeType == 'Improvement' }).length,
    regressionCount: benchResults.filter(function (br) { return br.changeType == 'Regression' }).length,
  }
}

// Some views require the data to be prepared in ways that are 
// too complicated for the template, so lets do it here.
dataViewPrepare = {
  'revision': function (data, viewData) {
    if (!data.benchGroups || !data.revisions) return {};
    var hash = viewData.hash;
    var rev = data.revisions[hash];
    if (!rev) return {};
    if (!rev.benchResults) return {};

    var groups = data.benchGroups.map(function (group) {
      var benchmarks = group.groupMembers.map(function (bn) {
	return rev.benchResults[bn]
      });
      return {
	groupName: group.groupName,
	benchResults: benchmarks,
	groupStats: groupStats(benchmarks),
      };
    });
    return {
      rev : rev,
      groups : groups,
    };
  },
}

function load_template () {
    console.log('Rebuilding page');
    var context = {};
    $.extend(context, data, viewData, settings);
    if (dataViewPrepare[view]){
      $.extend(context, dataViewPrepare[view](data, viewData));
    }
    $('#main').html(templates[view](context));

    $(".nav-loading").toggle(jQuery.active > 0);

    updateBenchFilter();
    updateCollapsedGroups();
    $('abbrv.timeago').timeago();

    if ($('#benchChart').length) {
    	setupChart();
    }
}
viewChanged.add(load_template);
dataChanged.add(load_template);

function setupChart () {
    
    var commits = commitsFrom(data.revisions, data.latest, data.settings.limitRecent);
    var benchName = viewData.benchName;

    $("<div id='tooltip' class='panel alert-info'></div>").css({
		position: "absolute",
		display: "none",
		//border: "1px solid #fdd",
		padding: "2px",
		//"background-color": "#fee",
		// opacity: 0.80,
                width: '300px',
	}).appendTo("#main");

    $.plot("#benchChart",
	[{
	  lines: { show: true, fill: true, fillColor: "rgba(255, 255, 255, 0.8)" },
	  points: { show: true, fill: false },
	  label: benchName,
	  data: commits.map(function (x,i){
	    if (!x.benchResults) return;
	    return [commits.length - i, x.benchResults[benchName].value]
	  }),
	}],
	{	
	  legend: {
		position: 'nw',
	  },
	  grid: {
		hoverable: true,
		clickable: true,
	  },
	  xaxis: {
		// ticks: values.map(function (x,i){return [i,x[0]]}),
		tickFormatter: function (i,axis) {
			if (i > 0 && i <= commits.length) {
				rev = commits[commits.length - i];
				if (! rev) return '';
				return shortRev(rev.summary.hash);
			} else {
				return '';
			}
		}
	  }
	});

    $("#benchChart").bind("plothover", function (event, pos, item) {
	if (item) {
		var v = item.datapoint[1];
		var i = item.dataIndex;
                var rev = commits[i].summary.hash;
                var summary = commits[i].summary;

		var tooltipContext = $.extend({value: v}, summary);

                if ($("#tooltip").data('rev') != rev) {
                    $("#tooltip")
		    	.html(shortRev(rev))
			.data('rev',rev)
		        .html(templates.revTooltip(tooltipContext))
                        .fadeIn(200)
                        .css({top: item.pageY+10, left: item.pageX-100})
                        .show();
                    $("#benchChart").css('cursor','pointer');
                }
	} else {
		$("#tooltip").data('rev',null).hide();
		$("#benchChart").css('cursor','default');
	}
    });
    $("#benchChart").bind("plotclick", function (event, pos, item) {
	if (item) {
		var v = item.datapoint[1];
		var i = item.dataIndex;
                var hash = commits[i].summary.hash;
		
		goTo(revisionRoute, {hash: hash});
	}
    });
}

indexRoute.matched.add(function(){
    view = 'index';
    viewChanged.dispatch();
    getJSON("latest-summaries.json");
});
completeRoute.matched.add(function(){
    view = 'complete';
    viewChanged.dispatch();
    getJSON("all-summaries.json");
});
revisionRoute.matched.add(function(hash){
    view = 'revision';
    viewData = { hash : hash };
    viewChanged.dispatch();
    getJSON("benchNames.json");
    getJSON("reports/" + hash + ".json");
});
graphIndexRoute.matched.add(function(){
    view = 'graphIndex';
    viewChanged.dispatch();
    getJSON("benchNames.json");
});
graphRoute.matched.add(function(benchName){
    view = 'graph';
    viewData = { benchName : benchName };
    viewChanged.dispatch();
    getJSON("latest-summaries.json");
    getJSON("graphs/" + benchName + ".json");
});

function updateCollapsedGroups() {
    // Does not work yet...
    /*

    var list = settings.collapsedGroups;
    console.log(list);
    if ($(".panel-collapse").length) {
	$(".panel-collapse").each(function (i){
	    if (i < list.length) {
		console.log(i, list[i], this);
		$(this).toggleClass('in', !list[i]);

		$(this).collapse();
		if (list[i]) {
		    $(this).collapse('hide');
		} else {
		    $(this).collapse('show');
		}
	    }
	});
    }
    */
}

function updateBenchFilter() {
    var showRegressions  = settings.benchFilter.regressions;
    var showBoring       = settings.benchFilter.boring;
    var showImprovements = settings.benchFilter.improvements;

    $('#show-regressions').toggleClass('active', showRegressions);
    $('#show-boring').toggleClass('active', showBoring); 
    $('#show-improvements').toggleClass('active', showImprovements);

    $('tr.row-Regression').toggle(showRegressions);
    $('tr.row-Boring').toggle(showBoring);
    $('tr.row-Improvement').toggle(showImprovements);

    $('.bench-panel').show().each(function() {
        if ($(this).has('tr.row-result:visible').length == 0) {
            $(this).hide();
        }
    });

    $('tr.summary-row').addClass('summary-row-collapsed');
    if (showBoring) {
        $('tr.summary-row:not(.summary-improvement):not(.summary-regression)')
            .removeClass('summary-row-collapsed');
    }
    if (showRegressions) {
        $('tr.summary-row.summary-regression')
            .removeClass('summary-row-collapsed');
    }
    if (showImprovements) {
        $('tr.summary-row.summary-improvement')
            .removeClass('summary-row-collapsed');
    }
    $('tr.summary-row').first()
            .removeClass('summary-row-collapsed');

    updateNothingToSee();
};

function updateNothingToSee() {
    $('.nothing-to-see')
	.toggle(jQuery.active == 0 && $('.bench-panel:visible, tr.summary-row:not(.summary-row-collapsed)').length == 0);


}

$(function (){
    $('body').on('click', '.benchSelector', function (event) {
        $(this).toggleClass('active');
	settings.benchFilter = {
	    regressions:  $('#show-regressions').hasClass('active'),
	    boring:       $('#show-boring').hasClass('active'), 
	    improvements: $('#show-improvements').hasClass('active'), 
	};
        updateBenchFilter();
    });
});

// Redirection

function goTo(route, params) {
	hasher.setHash(route.interpolate(params));
}


// Main setup

$(function() {
    $('#loading').hide();

    $(document).ajaxStart(function () {
	$(".nav-loading").show();
	updateNothingToSee();
    });
    $(document).ajaxStop(function () {
	$(".nav-loading").hide();
	updateNothingToSee();
    });

    // Load settins, then figure out what view to use.
    $.get("latest.txt", function (latest) {
        data.latest = latest;

        getJSON("settings.json", function (settings) {
            hasher.changed.add(handleChanges);
            hasher.initialized.add(handleChanges);
            hasher.init();
        });
    }, 'text');


});