try {
  var t = localStorage.getItem("hawk_theme");
  if (t) document.documentElement.dataset.theme = t;
} catch (e) {}
