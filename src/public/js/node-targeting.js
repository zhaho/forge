(function () {
  document.querySelectorAll('form.node-target-form').forEach(function (form) {
    form.addEventListener('submit', function () {
      form.querySelectorAll('input[name="nodeIds"]').forEach(function (el) { el.remove(); });
      document.querySelectorAll('.node-select-checkbox:checked').forEach(function (checkbox) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'nodeIds';
        input.value = checkbox.value;
        form.appendChild(input);
      });
    });
  });
})();
