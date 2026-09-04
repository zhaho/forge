(function () {
  var input = document.getElementById('component-search');
  if (!input) return;

  input.addEventListener('input', function () {
    var query = input.value.trim().toLowerCase();
    document.querySelectorAll('.component-option').forEach(function (li) {
      li.style.display = li.dataset.label.indexOf(query) !== -1 ? '' : 'none';
    });
  });
})();
