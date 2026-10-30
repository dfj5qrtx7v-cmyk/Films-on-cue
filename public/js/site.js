// Films on Cue: small progressive enhancements. The site works without this file.
document.documentElement.classList.add('js');

// Buttons with data-confirm ask before doing something that can't be undone.
document.addEventListener('submit', (event) => {
  const button = event.submitter;
  const message = (button && button.dataset.confirm) || event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});

// Move focus to the first problem on a form that came back with errors.
window.addEventListener('DOMContentLoaded', () => {
  const summary = document.querySelector('.error-summary');
  const first = document.querySelector('[aria-invalid="true"]');
  if (first) first.focus();
  else if (summary) summary.focus();
});

// On phones, fold the review filters away unless some are in use.
const filterPanel = document.querySelector('.filters-details');
if (filterPanel && !filterPanel.hasAttribute('data-keep-open') && window.matchMedia('(max-width: 640px)').matches) {
  filterPanel.open = false;
}
