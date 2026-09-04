(function () {
  // Any form with data-loading-text gets its submit button disabled and
  // relabeled immediately on submit, instead of waiting for the page navigation.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    var loadingText = form.getAttribute('data-loading-text');
    if (!loadingText) return;

    var button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = loadingText;
    }
  });
})();
