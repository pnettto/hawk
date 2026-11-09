try {
  var t = localStorage.getItem("hawk_theme");
  document.documentElement.dataset.theme = t || "hawk";
} catch (e) {
  document.documentElement.dataset.theme = "hawk";
}
