/* eslint-env browser */
'use strict';

const sections = document.querySelectorAll('[id]');
const navLinks = document.querySelectorAll('.nav-link[href^="#"]');

function updateActiveLink() {
  let current = '';
  sections.forEach((s) => {
    if (s.getBoundingClientRect().top <= 80) current = s.id;
  });
  navLinks.forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + current);
  });
}

document.querySelector('.content').addEventListener('scroll', updateActiveLink);
updateActiveLink();
