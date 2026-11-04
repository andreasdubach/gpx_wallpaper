/**
 * GPX ELEVATION PROFILE — BEGINNER'S GUIDE
 * -----------------------------------------
 * Flow: select a GPX file -> read its XML -> extract GPS coordinates and
 * elevations -> calculate distance -> draw an SVG -> optionally download it.
 *
 * JavaScript basics used here:
 *   const = a variable that cannot be reassigned to a different value.
 *   let   = a variable whose value may change later.
 *   null  = deliberately means "nothing stored yet".
 *   function name(...) { ... } = reusable code called by its name.
 *   // starts a single-line comment; slash-star begins a block comment.
 *
 * This script assumes index.html already contains elements with the IDs below.
 */

// document represents the current HTML page (the Document Object Model / DOM).
// getElementById finds one HTML element by its id attribute.
// We store these references so we can read or update the page later.
const fileInput = document.getElementById("gpxFile");
const downloadButton = document.getElementById("downloadButton");
const statusElement = document.getElementById("status");
const statsElement = document.getElementById("stats");
const distanceValue = document.getElementById("distanceValue");
const minElevationValue = document.getElementById("minElevationValue");
const maxElevationValue = document.getElementById("maxElevationValue");
const graphElement = document.getElementById("graph");

// The range slider and the text displaying its current multiplier (e.g. "3×").
const verticalScale =
  document.getElementById("verticalScale");
const verticalScaleValue =
  document.getElementById("verticalScaleValue");

// App state: values we need to remember between separate user actions.
// The initial SVG/profile are null because no GPX has been loaded yet.
// currentFileName supplies a fallback name for downloads.
let currentSvg = null;
let currentFileName = "elevation-profile";
let currentProfile = null;

// EVENT LISTENERS: "When the user does X, run function Y."
// We pass handleFile (without parentheses) so it runs LATER, on file selection.
// "click" happens when the download button is activated.
fileInput.addEventListener("change", handleFile);
downloadButton.addEventListener("click", downloadPng);

// "input" fires continuously as the slider moves; "change" often fires only
// when the user finishes adjusting it.
// () => { ... } is an arrow function: a short function defined right here.
// We keep currentProfile in memory so changing the slider does NOT reread GPX.
verticalScale.addEventListener("input", () => {
  verticalScaleValue.textContent =
    `${verticalScale.value}×`;

  if (currentProfile) {
    renderGraph(currentProfile);
  }
});

/**
 * handleFile(event)
 * Purpose: coordinate everything when a GPX file is selected.
 * "event" is supplied by the browser and tells us which input changed.
 * "async" allows this function to wait for asynchronous file reading.
 *
 * Steps: get file -> read text -> parse GPX -> build profile -> draw/update UI.
 * Any error jumps to catch, where we show a message and clear the graph.
 */
async function handleFile(event) {
  // event.target is the <input type="file"> element.
  // files is a list of selected files; [0] means the first one.
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  // try/catch lets us show a friendly message if reading or parsing fails.
  try {
    statusElement.textContent = `Reading ${file.name}...`;

    // file.text() returns a Promise (a result that arrives asynchronously).
    // await pauses THIS async function until the file contents are available.
    // The GPX file is processed locally in the browser, not sent to a server.
    const text = await file.text();
    const trackPoints = parseGpx(text);

    // We need at least two valid points to draw a line between them.
    // throw creates an error; execution skips to catch below.
    if (trackPoints.length < 2) {
      throw new Error(
        "This GPX file does not contain enough track points with elevation data."
      );
    }

    const profile = buildElevationProfile(trackPoints);

    // Save the processed data for future slider updates.
    // profile is an array like [{x: 0, y: 520}, {x: 0.12, y: 528}, ...].
    // x = cumulative distance in km; y = elevation in metres.
    currentProfile = profile;

    renderGraph(profile);
    updateStats(profile);

    // Regular expression /\.gpx$/i means ".gpx" at the END of the name,
    // ignoring case. replace(..., "") removes that suffix.
    // || chooses the fallback if the resulting name is empty.
    currentFileName = file.name.replace(/\.gpx$/i, "") || "elevation-profile";

    statusElement.textContent =
      `Loaded ${trackPoints.length.toLocaleString()} track points from ${file.name}.`;

    downloadButton.disabled = false;
    statsElement.hidden = false;
  // If ANY step above throws an error, we end up here.
  // console.error helps debugging in the browser's Developer Tools console.
  } catch (error) {
    console.error(error);

    statusElement.textContent =
      `Could not read GPX file: ${error.message}`;

    downloadButton.disabled = true;
    statsElement.hidden = true;
    graphElement.innerHTML = "";
    currentSvg = null;
    currentProfile = null; // Do not redraw the previous file if the slider moves.
  }
}

/**
 * parseGpx(gpxText) -> array of {lat, lon, elevation}
 * GPX is XML, a markup format with elements such as:
 * <trkpt lat="47.1" lon="8.5"><ele>610</ele></trkpt>
 *
 * DOMParser converts the XML string into a document we can query.
 * This version reads TRACK points (<trkpt>), not route points (<rtept>).
 * It skips points with missing or invalid latitude/longitude/elevation.
 */
function parseGpx(gpxText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, "application/xml");

  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("Invalid XML.");
  }

  // querySelectorAll returns matching XML elements (a NodeList).
  // [...nodeList] uses "spread" syntax to make a normal JavaScript array.
  const pointElements = [...xml.querySelectorAll("trkpt")];

  // .map() transforms EACH XML point into a plain JavaScript object.
  // .filter() then keeps only objects that satisfy all validity checks.
  // "return" sends the resulting array back to handleFile.
  return pointElements
    .map((point) => {
      const lat = Number.parseFloat(point.getAttribute("lat"));
      const lon = Number.parseFloat(point.getAttribute("lon"));
      const elevationElement = point.querySelector("ele");
      // Ternary operator: condition ? valueIfTrue : valueIfFalse.
      // NaN means "Not a Number"; we remove those entries in filter().
      const elevation = elevationElement
        ? Number.parseFloat(elevationElement.textContent)
        : NaN;

      return { lat, lon, elevation };
    })
    .filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lon) &&
        Number.isFinite(point.elevation)
    );
}

/**
 * buildElevationProfile(points) -> [{x: distanceKm, y: elevationM}, ...]
 * Turns raw GPS points into points suitable for plotting.
 * Each x is distance from the START, not distance from the previous point.
 */
function buildElevationProfile(points) {
  let cumulativeDistanceKm = 0;

  // map supplies both the current point and its index (0, 1, 2, ...).
  // At index 0, cumulative distance is zero.
  // After that, add distance between the previous and current GPS points.
  const profile = points.map((point, index) => {
    if (index > 0) {
      cumulativeDistanceKm += haversineDistanceKm(
        points[index - 1],
        point
      );
    }

    return {
      x: cumulativeDistanceKm,
      y: point.elevation
    };
  });

  return profile;
}

// TODO: build function buildGpsProfile here. We already have lat and lon

/**
 * haversineDistanceKm(pointA, pointB) -> distance in kilometres
 * Estimates the shortest path along Earth's spherical surface between two
 * latitude/longitude pairs. This is horizontal distance, not 3D distance
 * including elevation changes. 6371 km is an approximate Earth radius.
 * Trigonometry uses radians, so we convert degrees first.
 */
function haversineDistanceKm(pointA, pointB) {
  const earthRadiusKm = 6371;

  const lat1 = degreesToRadians(pointA.lat);
  const lat2 = degreesToRadians(pointB.lat);

  const deltaLat = degreesToRadians(pointB.lat - pointA.lat);
  const deltaLon = degreesToRadians(pointB.lon - pointA.lon);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

/** Convert degrees to radians. A full circle is 360 degrees = 2*pi radians. */
function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * renderGraph(profile)
 * Creates an SVG elevation line and places it into the page.
 *
 * Coordinate systems:
 *   profile.x is kilometres along the route.
 *   profile.y is metres above sea level.
 *   SVG x increases to the RIGHT; SVG y increases DOWNWARD.
 *
 * Vertical exaggeration 1 means equal horizontal/vertical physical scale
 * BEFORE adding padding or resizing the entire SVG in CSS.
 * 3 means elevation differences are drawn three times as tall.
 */
function renderGraph(profile) {
  // Extract only the y/elevation values into a new array.
  // Math.min/Math.max need individual arguments; ... spreads the array.
  const elevations = profile.map((point) => point.y);

  const minElevationM = Math.min(...elevations);
  const maxElevationM = Math.max(...elevations);

  const distanceKm = profile[profile.length - 1].x;
  // Never allow a zero vertical range (a perfectly flat track).
  // The 1-metre minimum keeps the SVG height nonzero.
  const elevationRangeM = Math.max(
    maxElevationM - minElevationM,
    1
  );

  const elevationRangeKm =
    elevationRangeM / 1000;

  // Form control .value is a STRING, even for a numeric range slider.
  // Number(...) converts it into a number so arithmetic works as expected.
  const verticalExaggeration =
    Number(verticalScale.value);

  // Internal SVG units per kilometre. This is a convenient drawing scale,
  // NOT necessarily the number of screen pixels after responsive CSS scaling.
  const pixelsPerKm = 100;

  // True physical width
  const width =
    distanceKm * pixelsPerKm;

  // Vertical size, optionally exaggerated
  const height =
    elevationRangeKm *
    pixelsPerKm *
    verticalExaggeration;

  const xScale =
    pixelsPerKm;

  // Elevation is in METRES, while distance is in KILOMETRES.
  // Divide by 1000 to convert metres to kilometres before scaling.
  const yScale =
    (pixelsPerKm / 1000) *
    verticalExaggeration;

  // Padding is an object with four named properties.
  // It prevents the stroke touching/clipping at the SVG edges.
  // Padding adds whitespace; it does not stretch the plotted terrain.
  const padding = {
    top: 20,
    right: 20,
    bottom: 20,
    left: 20
  };

  const svgWidth =
    width +
    padding.left +
    padding.right;

  const svgHeight =
    height +
    padding.top +
    padding.bottom;

  // Convert each geographic profile point into an SVG "x,y" coordinate.
  // toFixed(2) rounds to 2 decimal places and returns a STRING.
  // SVG <polyline> expects a space-separated string like "20,45 30,42".
  const points = profile.map((point) => {
    const x =
      padding.left +
      point.x * xScale;

    const elevationAboveMinimumM =
      point.y - minElevationM;

    // Subtracting from height FLIPS the vertical axis:
    // high elevations appear toward the top instead of the bottom.
    const y =
      padding.top +
      height -
      elevationAboveMinimumM * yScale;

    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  // Backticks (`...`) make a template literal: a string that may span
  // multiple lines and interpolate expressions using ${...}.
  // viewBox defines the SVG's internal coordinate system.
  // preserveAspectRatio="... meet" fits the entire drawing without cropping.
  // polyline joins our coordinate pairs in order.
  // vector-effect="non-scaling-stroke" keeps stroke width visually consistent
  // when the SVG is resized in CSS.
const svg = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${svgWidth} ${svgHeight}"
    role="img"
    aria-label="Elevation profile"
    preserveAspectRatio="xMidYMid meet"
  >

    <!-- Define the blur effect -->
    <defs>
      <filter
        id="softGlow"
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>

    <!-- Blurred line underneath -->
    <polyline
      points="${points.join(" ")}"
      fill="none"
      stroke="#ff6600"
      stroke-width="15"
      stroke-opacity="0.35"
      filter="url(#softGlow)"
      vector-effect="non-scaling-stroke"
      stroke-linejoin="round"
      stroke-linecap="round"
    />

    <!-- Sharp line on top -->
    <polyline
      points="${points.join(" ")}"
      fill="none"
      stroke="#ff6600"
      stroke-width="3"
      vector-effect="non-scaling-stroke"
      stroke-linejoin="round"
      stroke-linecap="round"
    />

  </svg>
`;

  // Insert the SVG markup into <div id="graph">, replacing the old graph.
  // querySelector retrieves the actual newly created <svg> DOM element.
  // We save it in currentSvg so the download button can serialize it.
  graphElement.innerHTML = svg;
  currentSvg = graphElement.querySelector("svg");
}

/**
 * updateStats(profile)
 * Updates the visible distance/min/max labels in index.html.
 * textContent replaces an element's text (not its HTML markup).
 * toFixed(2) displays two decimals; Math.round rounds to whole metres.
 */
function updateStats(profile) {
  const elevations = profile.map((point) => point.y);
  const totalDistance = profile[profile.length - 1].x;
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);

  distanceValue.textContent = `${totalDistance.toFixed(2)} km`;
  minElevationValue.textContent = `${Math.round(minElevation)} m`;
  maxElevationValue.textContent = `${Math.round(maxElevation)} m`;
}

async function downloadPng() {
  if (!currentSvg) {
    return;
  }

  // 1. Determine the wallpaper resolution.
  const screenWidth = Math.round(
    window.screen.width * window.devicePixelRatio
  );

  const screenHeight = Math.round(
    window.screen.height * window.devicePixelRatio
  );

  // 2. Create a canvas at that resolution.
  const canvas = document.createElement("canvas");

  canvas.width = screenWidth;
  canvas.height = screenHeight;

  const context = canvas.getContext("2d");

  // 3. Fill the wallpaper background.
  context.fillStyle = "#121414";
  context.fillRect(
    0,
    0,
    screenWidth,
    screenHeight
  );

  // 4. Convert the existing SVG into an image.
  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(currentSvg);

  const svgBlob = new Blob(
    [svgText],
    { type: "image/svg+xml;charset=utf-8" }
  );

  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.src = svgUrl;

    await image.decode();

    // 5. Get the original SVG dimensions.
    const viewBox = currentSvg.viewBox.baseVal;

    const originalWidth = viewBox.width;
    const originalHeight = viewBox.height;

    // 6. Define wallpaper padding.
    const horizontalPadding = screenWidth * 0.04;
    const verticalPadding = screenHeight * 0.10;

    const availableWidth =
      screenWidth - horizontalPadding * 2;

    const availableHeight =
      screenHeight - verticalPadding * 2;

    // 7. Scale the graph to fit the wallpaper.
    // Preserve its aspect ratio.
    const scale = Math.min(
      availableWidth / originalWidth,
      availableHeight / originalHeight
    );

    const graphWidth = originalWidth * scale;
    const graphHeight = originalHeight * scale;

    // 8. Center the graph.
    const x = (screenWidth - graphWidth) / 2;
    const y = (screenHeight - graphHeight) / 2;

    // 9. Draw the graph onto the wallpaper.
    context.drawImage(
      image,
      x,
      y,
      graphWidth,
      graphHeight
    );

    // 10. Convert the canvas into a PNG.
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not create PNG."));
        }
      }, "image/png");
    });

    // 11. Download the wallpaper.
    const pngUrl = URL.createObjectURL(pngBlob);

    const link = document.createElement("a");

    link.href = pngUrl;
    link.download =
      `${currentFileName}-wallpaper-${screenWidth}x${screenHeight}.png`;

    link.click();

    setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);

  } catch (error) {
    console.error(error);

    statusElement.textContent =
      `Could not export wallpaper: ${error.message}`;

  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
