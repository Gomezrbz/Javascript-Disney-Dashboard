
	// Optional: You can specify a LogicMonitor API bearer token or API ID & key to use for the widget...
	let apiBearerToken = "";
	let lmAPIID = "";
	let lmAPIKey = "";

	// Whether we're plotting "groups" or "resources" or "services" (strongly recommend staying with groups or services)...
	// You can either set it here or in a dashboard token named 'MapSourceType'...
	let mapSourceType = "groups";

	// The property to use for the location of the items on the map. Default is "location"...
	// You can either set it here or in a dashboard token named 'MapLocationProperty'...
	let mapLocationProperty = "location";

	// Preferred map style. Available options: "silver" (the default), "standard", "dark", "aubergine", "silverblue", "satellite", or "satellite-light"...
	let mapStyle = "dark";

	// Whether to ignore items with no active alerts (useful for maps with thousands of markers)...
	// You can either set it here or in a dashboard token named 'MapIgnoreCleared'...
	let showCleared = true;
	let showWarnings = true;
	let showErrors = true;
	let showCriticals = true;
	let showSDT = true;

	// Capture if a group filter...
	// You can set it here or in a dashboard token named "MapGroupPathFilter"...
	let groupPathFilter = "*";

	// Interval for updating group status data (in minutes)...
	let statusUpdateIntervalMinutes = 2;

	// Flag to disable marker clustering if needed...
	let disableClustering = false;

	// Whether to show weather by default. Options are: "no", "global", "nexrad"...
	// You can set it here or in a dashboard token named "MapShowWeather"...
	let showWeatherDefault = "no";

	// If weather is shown, whether to show "wildfires" or "us-wildfires" or "outages" or "us-poweroutages" or "us-flooding" or "earthquakes"...
	// You can set it here or in a dashboard token named "MapOverlayOption"...
	let additionalOverlayOption = "earthquakes";

	// Whether to show or hide the map options along the top of the widget by default...
	// You can set it here or in a dashboard token named "HideMapOptions"...
	let hideMapOptionsByDefault = false;

	// Whether to automatically center the map to encompass all items during timed refreshes...
	// You can set it here or in a dashboard token named "AutoResetMapOnRefresh"...
	let autoResetMapOnRefresh = true;

	// When true will not refresh the data on a timed interval (useful ONLY during development)...
	let developmentFlag = false;

	// Since we generally don't need to poll all properties every time, we can just grab them initially then occasionally every x number of polls based on the following variable (set to 0 to perform a full refresh every time)...
	const fullRefreshInterval = 0;

	// Optional angle & heading for the Google Map...
	let showMapTiltControls = false;
	let mapTilt = 0;
	let mapHeading = 0;

	// Whether to include inherited locations in addition to those directly set on resources and/or services (disabling this can greatly increase refresh speed)...
	const pollInheritedLocations = true;

	// Typically if both a 'latitude' & 'longitude' property are set, then we can assume the address is already geocoded. Set this to "true" to force geocoding the address instead...
	const ignoreLatLongProps = false;

	// Whether the Google Maps uses the "cooperative" gesture handling, or "greedy" that allows mouse-wheel zooming without having to hold a modifier key (Google's default is "cooperative")...
	const mapGestureHandling = "cooperative";
	// Whether to show road labels...
	let showRoadLabels = "off";

	// An optional comma-delimited list of custom properties to show when viewing a group's/resource's details...
	// You can set it here or in a dashboard token named "MapDisplayProperties"...
	let displayProps = "";

	// Property to look for connecting information in...
	const connectionInfoProp = "auto.custom_map_connection_data";
	// Stroke weight of connecting lines...
	const connectingLineWeight = 3;
	// Whether to use geodesic lines when connecting two locations (I recommend not so it just plots a straight line vs curve of the Earth)...
	const useGeodesicLines = false;

	// Default opacity for weather layers...
	let weatherOpacity = 0.35;
	// Default opacity for satellite weather layers...
	const satelliteWeatherOpacity = 0.6;
	// Color scheme for the "global" weather option...
	// See https://rainviewer.com/api/color-schemes.html for color scheme options (values are 0-8)...
	const rvOptionColorScheme = 8;
	// Weather refresh interval in minutes...
	const weatherRefreshMinutes = 5;
	// Whether to display details about a wildfire on "click" or "mouseover"...
	const showWildfireInfoEvent = "click";
	// Whether the opacity of an earthquake's icon reflects "time" since the event, or "magnitude"...
	let quakeMode = "time";

	// --- FilterWidget v7 URL bridge (Alert Dashboard) ---
	// Parses ?filters= RP JSON and applies Device Groups / Devices to map defaults.
	// Intercepts device API responses to honor Devices selection.
	// Shows a banner when metadata/category filters cannot be applied to the map.
	(function applyFilterWidgetBridge() {
		function parseFilters() {
			try {
				const loc = (parent && parent.window && parent.window.location) ? parent.window.location : window.location;
				const raw = new URLSearchParams(loc.search).get('filters');
				if (!raw) return [];
				const parsed = JSON.parse(decodeURIComponent(raw));
				return Array.isArray(parsed) ? parsed : [];
			} catch (e) { return []; }
		}
		function selected(entry) {
			if (!entry || !Array.isArray(entry.v)) return [];
			return entry.v.filter(function (x) { return x && x.isSelected !== false; })
				.map(function (x) { return String(x.value == null ? '' : x.value); })
				.filter(function (v) { return v && v !== '*'; });
		}
		function stripGlob(v) { return String(v).replace(/\*+$/, ''); }

		const filters = parseFilters();
		const byProp = {};
		filters.forEach(function (f) { if (f && f.n) byProp[f.n] = selected(f).map(stripGlob); });

		const groups = byProp['system.groups'] || [];
		const devices = byProp['system.displayname'] || [];
		const unsupported = [];
		['system.categories', 'customer', 'department', 'device_type', 'location'].forEach(function (p) {
			const vals = byProp[p] || [];
			if (vals.length) unsupported.push(p);
		});

		if (groups.length) {
			const paths = groups.map(function (g) {
				const b = stripGlob(g);
				return b.indexOf('*') >= 0 ? b : (b + '*');
			});
			groupPathFilter = paths.join('|');
		}

		if (devices.length) {
			mapSourceType = 'resources';
			if (!groups.length) groupPathFilter = '*';
			window.__lmAlertMapDeviceFilter = devices.slice();
		}

		window.__lmAlertMapUnsupportedFilters = unsupported.slice();

		// Filter /device/devices JSON responses to selected display names when set
		if (devices.length && !window.__lmAlertMapFetchPatched) {
			window.__lmAlertMapFetchPatched = true;
			const allow = new Set(devices);
			const origFetch = window.fetch.bind(window);
			window.fetch = function (input, init) {
				const url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
				return origFetch(input, init).then(function (resp) {
					if (!url || url.indexOf('/device/devices') < 0) return resp;
					return resp.clone().json().then(function (body) {
						try {
							const items = (body && body.data && body.data.items) || (body && body.items);
							if (Array.isArray(items)) {
								const filtered = items.filter(function (d) {
									return allow.has(d.displayName) || allow.has(d.name);
								});
								if (body.data && body.data.items) {
									body.data.items = filtered;
									if (typeof body.data.total === 'number') body.data.total = filtered.length;
								} else if (body.items) {
									body.items = filtered;
									if (typeof body.total === 'number') body.total = filtered.length;
								}
								return new Response(JSON.stringify(body), {
									status: resp.status,
									statusText: resp.statusText,
									headers: { 'Content-Type': 'application/json' }
								});
							}
						} catch (e) { /* fall through */ }
						return resp;
					}).catch(function () { return resp; });
				});
			};
		}

		function showBanner() {
			const msgs = [];
			if (unsupported.length) {
				msgs.push('Map does not apply: ' + unsupported.join(', ') + '. Summary widgets and the alert table still honor these filters.');
			}
			if (devices.length) {
				msgs.push('Devices filter applied to map resource markers.');
			} else if (groups.length) {
				msgs.push('Device Groups filter applied to map group path.');
			}
			if (!msgs.length) return;
			const bar = document.createElement('div');
			bar.id = 'lmMapFilterBanner';
			bar.setAttribute('style', 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:11px;color:#c8cdd3;background:#252a31;border:1px solid #3a3f46;padding:6px 10px;margin:0 0 4px;border-radius:3px;');
			bar.textContent = msgs.join(' ');
			const body = document.querySelector('.customMapBody');
			if (body && body.parentNode) body.parentNode.insertBefore(bar, body);
			else document.body.insertBefore(bar, document.body.firstChild);
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', showBanner);
		} else {
			setTimeout(showBanner, 0);
		}
	})();
	// --- end FilterWidget bridge ---

