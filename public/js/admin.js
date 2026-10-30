// Films on Cue dashboard helpers. Loaded in <head> so the editor settings apply before it starts.

if (window.Trix) {
  // write paragraphs as <p> (each new line becomes its own paragraph when saved)
  Trix.config.blockAttributes.default.tagName = 'p';
}
// images go in the Image box, not inside the text
document.addEventListener('trix-file-accept', (event) => event.preventDefault());

document.addEventListener('DOMContentLoaded', () => {
  // Show the chosen image before it's uploaded.
  const file = document.getElementById('image');
  const preview = document.querySelector('[data-image-preview]');
  if (file && preview) {
    file.addEventListener('change', () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      const img = new Image();
      img.alt = '';
      img.src = URL.createObjectURL(chosen);
      preview.replaceChildren(img);
    });
  }

  // Suggested-length counters.
  document.querySelectorAll('[data-count]').forEach((field) => {
    const max = Number(field.dataset.count);
    const out = document.createElement('p');
    out.className = 'hint counter';
    field.after(out);
    const update = () => {
      const n = field.value.length;
      out.textContent = n > max ? `${n - max} over the suggested ${max} characters` : `${max - n} of the suggested ${max} characters left`;
    };
    field.addEventListener('input', update);
    update();
  });

  // Preview the review's web address from its title.
  const title = document.getElementById('title');
  const slug = document.getElementById('slug');
  const slugPreview = document.querySelector('[data-slug-preview]');
  const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'film-title';
  if (title && slug && slugPreview) {
    const sync = () => { slugPreview.textContent = slugify(slug.value || title.value); };
    title.addEventListener('input', sync);
    slug.addEventListener('input', sync);
  }

  // Warn before leaving a review with unsaved changes.
  const form = document.querySelector('.review-form');
  if (form) {
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('trix-change', () => { dirty = true; });
    form.addEventListener('submit', () => { dirty = false; });
    window.addEventListener('beforeunload', (event) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    });
  }
});
