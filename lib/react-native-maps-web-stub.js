// Web stub for react-native-maps — the .native.tsx component handles native,
// this stub prevents the package from crashing when bundled for web.
const React = require("react");
const { View } = require("react-native");

const MapView = (props) => React.createElement(View, props, props.children);
MapView.Animated = MapView;

const Marker = (props) => null;
const Circle = (props) => null;
const Polyline = (props) => null;
const Polygon = (props) => null;
const Callout = (props) => null;
const CalloutSubview = (props) => null;
const Overlay = (props) => null;
const Heatmap = (props) => null;
const Geojson = (props) => null;

const PROVIDER_DEFAULT = null;
const PROVIDER_GOOGLE = "google";

module.exports = {
  default: MapView,
  MapView,
  Marker,
  Circle,
  Polyline,
  Polygon,
  Callout,
  CalloutSubview,
  Overlay,
  Heatmap,
  Geojson,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
};
