// Motion for the landing page: headings that rise word by word out of a mask,
// buttons that lean toward the pointer and copy blocks that tilt in 3D under
// it. Only transform and opacity are animated, and none of it runs when the
// visitor has asked for reduced motion.
export function landingMotion(story) {
  if (!story) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Split each chapter heading into masked words. The text stays readable to
  // assistive technology through the aria-label on the heading.
  for (const heading of story.querySelectorAll('.story-copy h3')) {
    const words = heading.textContent.trim().split(/\s+/);
    heading.setAttribute('aria-label', heading.textContent.trim());
    heading.textContent = '';
    words.forEach((word, index) => {
      const mask = document.createElement('span');
      mask.className = 'word';
      mask.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('i');
      inner.textContent = word;
      inner.style.setProperty('--i', index);
      mask.append(inner);
      heading.append(mask, ' ');
    });
  }
  if (calm || !fine) return;

  // Magnetic buttons: the button travels a fraction of the way to the pointer
  // and springs back when it leaves.
  for (const button of story.querySelectorAll('.enter-globe, #explore-orbit')) {
    button.classList.add('magnetic');
    button.addEventListener('pointermove', (event) => {
      const box = button.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) * 0.28;
      const y = (event.clientY - box.top - box.height / 2) * 0.36;
      button.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
    button.addEventListener('pointerleave', () => { button.style.transform = ''; });
  }

  // Perspective tilt on the chapter copy.
  for (const copy of story.querySelectorAll('.story-copy')) {
    copy.addEventListener('pointermove', (event) => {
      const box = copy.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width - 0.5;
      const py = (event.clientY - box.top) / box.height - 0.5;
      copy.style.transform =
        `perspective(900px) rotateY(${(px * 7).toFixed(2)}deg) rotateX(${(-py * 6).toFixed(2)}deg) translateZ(0)`;
    });
    copy.addEventListener('pointerleave', () => { copy.style.transform = ''; });
  }
}
