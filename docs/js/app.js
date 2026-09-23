/* My Study Space — runs entirely in the browser, no network needed.
   Data comes from data/site-data.js (built by scripts/study.py). Progress lives in localStorage. */
(function () {
  'use strict';

  var DATA = window.STUDY_DATA || { subjects: [], lessons: [] };
  var SUBJECTS = DATA.subjects;
  var LESSONS = DATA.lessons;
  var app = document.getElementById('app');
  var PASS_PCT = 70;
  var NEW_BADGE_DAYS = 14;

  var SUBJECT_COLORS = {
    'Math': '#5b7fc7', 'Physics': '#7a6cc4', 'Chemistry': '#3f9a8a', 'Biology': '#5e9d55',
    'English': '#c98a4b', 'Arabic': '#b9645a', 'Islamic Studies': '#4d8f6b', 'Social Studies': '#a9863f'
  };

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // escape, then allow **bold**, `code` and line breaks
  function rich(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                 .replace(/`(.+?)`/g, '<code>$1</code>')
                 .replace(/\n/g, '<br>');
  }
  function dirAttr(lesson) {
    var d = lesson && lesson.dir;
    if (!d && lesson && lesson.subject === 'Arabic') d = 'rtl';
    return 'dir="' + (d === 'rtl' || d === 'ltr' ? d : 'auto') + '"';
  }
  // Only for lessons with a fixed direction: flips the whole layout (column side, button side) too
  function layoutDir(lesson) {
    var a = dirAttr(lesson);
    return a === 'dir="auto"' ? '' : a;
  }
  function getLesson(id) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i];
    return null;
  }
  function lessonsOf(subject) {
    return LESSONS.filter(function (l) { return l.subject === subject; })
      .sort(function (a, b) {
        return (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title, undefined, { numeric: true });
      });
  }
  function questionCount(l) {
    var q = l.quiz || {};
    return (q.multipleChoice || []).length + (q.shortAnswer || []).length + (q.examStyle || []).length;
  }
  function fileUrl(path) { return encodeURI(path).replace(/#/g, '%23'); }
  function fileName(path) { return String(path).split('/').pop(); }
  function isNew(lesson) {
    if (!lesson.addedAt) return false;
    var added = new Date(lesson.addedAt).getTime();
    if (isNaN(added)) return false;
    return (Date.now() - added) < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
  }
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // A lesson is "v2" (redesigned page) if it has the new authoring fields; older lessons
  // keep working exactly as before via the classic tab layout until they're re-processed.
  function isV2(l) { return !!(l.idea || l.examples || l.summaryCard); }
  function youtubeSearchUrl(q) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q || ''); }
  function difficultyDots(level) {
    var n = level === 'hard' ? 3 : level === 'medium' ? 2 : 1;
    var html = '<span class="difficulty" aria-label="Difficulty: ' + esc(level || 'easy') + '">';
    for (var i = 1; i <= 3; i++) html += '<span class="dot' + (i <= n ? ' on' : '') + '"></span>';
    return html + '</span> <span style="text-transform:capitalize">' + esc(level || 'easy') + '</span>';
  }
  function boxLabel(type) {
    return type === 'formula' ? 'Formula' : type === 'rule' ? 'Rule' : type === 'date' ? 'Key date' : 'Note';
  }

  /* ---------------- progress (localStorage, with in-memory fallback) ---------------- */
  var STORE_KEY = 'study.progress.v1';
  var memStore = null;
  function loadStore() {
    if (memStore) return memStore;
    try { memStore = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { memStore = {}; }
    if (!memStore.lessons) memStore.lessons = {};
    return memStore;
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(memStore)); } catch (e) { /* private mode etc. */ }
  }
  function getP(id) {
    var s = loadStore();
    var p = s.lessons[id] || {};
    return {
      studied: !!p.studied, best: p.best || null, last: p.last || null, attempts: p.attempts || 0, lastWrong: p.lastWrong || [],
      kpisChecked: p.kpisChecked || [], revealed: p.revealed || {}, myVideos: p.myVideos || []
    };
  }
  function setP(id, patch) {
    var s = loadStore();
    var cur = s.lessons[id] || {};
    for (var k in patch) cur[k] = patch[k];
    s.lessons[id] = cur;
    saveStore();
  }
  function subjectProgress(subject) {
    var ls = lessonsOf(subject), done = 0;
    ls.forEach(function (l) { if (getP(l.id).studied) done++; });
    return { total: ls.length, done: done, pct: ls.length ? Math.round(100 * done / ls.length) : 0 };
  }

  /* ---------------- search ---------------- */
  function normWithMap(str) {
    var out = '', map = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (/[ً-ٰٟـ]/.test(ch)) continue;           // Arabic diacritics + tatweel
      if (/[أإآٱ]/.test(ch)) ch = 'ا';       // alef variants -> alef
      else if (ch === 'ى') ch = 'ي';                        // alef maqsura -> ya
      out += ch.toLowerCase(); map.push(i);
    }
    return { s: out, map: map };
  }
  var searchIndex = null;
  function buildIndex() {
    searchIndex = [];
    LESSONS.forEach(function (l) {
      function add(tab, label, text) {
        if (!text) return;
        var n = normWithMap(text);
        searchIndex.push({ lesson: l, tab: tab, label: label, text: text, norm: n });
      }
      var v2 = isV2(l);
      add(v2 ? 'explanation' : 'summary', 'Lesson title', l.title);
      if (v2 && l.idea) {
        add('idea', 'The idea', [l.idea.simple, l.idea.academic, l.idea.analogy].filter(Boolean).join(' '));
      }
      (l.explanation || l.summary || []).forEach(function (sec) {
        add(v2 ? 'explanation' : 'summary', v2 ? 'Explanation' : 'Summary',
          (sec.heading ? sec.heading + ' — ' : '') + (sec.text || '') + ' ' + (sec.bullets || []).join(' · ') + (sec.box ? ' ' + sec.box.content : ''));
      });
      (l.kpis || []).forEach(function (k) { add(v2 ? 'glance' : 'kpis', 'KPI', k); });
      (l.keyTerms || []).forEach(function (t) { add(v2 ? 'explanation' : 'terms', 'Key term', t.term + ' — ' + t.definition); });
      (l.examples || []).forEach(function (ex) {
        var stepText = (ex.steps || []).map(function (s) { return (s.explain || '') + ' ' + (s.work || '') + ' ' + (s.why || ''); }).join(' ');
        add('examples', 'Worked example', (ex.title || '') + ' ' + (ex.problem || '') + ' ' + stepText + ' ' + (ex.answer || ''));
      });
      if (l.summaryCard) {
        add('revise', 'Revision summary', (l.summaryCard.points || []).join(' ') + ' ' + (l.summaryCard.mustNotForget || []).join(' '));
      }
      var q = l.quiz || {};
      (q.multipleChoice || []).forEach(function (m) { add(v2 ? 'practice' : 'quiz', 'Quiz', m.question + ' ' + (m.options || []).join(' | ')); });
      (q.shortAnswer || []).forEach(function (m) { add(v2 ? 'practice' : 'quiz', 'Quiz', m.question); });
      (q.examStyle || []).forEach(function (m) { add(v2 ? 'practice' : 'quiz', 'Quiz', m.question); });
    });
  }
  function highlight(entry, words) {
    var ranges = [], n = entry.norm;
    words.forEach(function (w) {
      var from = 0, idx;
      while ((idx = n.s.indexOf(w, from)) !== -1 && ranges.length < 40) {
        ranges.push([n.map[idx], n.map[idx + w.length - 1] + 1]); from = idx + w.length;
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var first = ranges.length ? ranges[0][0] : 0;
    var start = Math.max(0, first - 50), end = Math.min(entry.text.length, first + 130);
    var html = '', pos = start;
    ranges.forEach(function (r) {
      if (r[1] <= pos || r[0] >= end) return;
      var a = Math.max(r[0], pos), b = Math.min(r[1], end);
      html += esc(entry.text.slice(pos, a)) + '<mark>' + esc(entry.text.slice(a, b)) + '</mark>';
      pos = b;
    });
    html += esc(entry.text.slice(pos, end));
    return (start > 0 ? '…' : '') + html + (end < entry.text.length ? '…' : '');
  }
  function runSearch(q) {
    if (!searchIndex) buildIndex();
    var words = normWithMap(q.trim()).s.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var hits = [];
    searchIndex.forEach(function (e) {
      if (words.every(function (w) { return e.norm.s.indexOf(w) !== -1; })) {
        hits.push({ e: e, score: (e.label === 'Lesson title' ? 3 : e.label === 'Key term' ? 2 : 1) });
      }
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    return { words: words, hits: hits };
  }

  /* ---------------- views ---------------- */
  function viewHome() {
    document.title = 'My Study Space';
    var totalLessons = LESSONS.length, doneLessons = 0;
    LESSONS.forEach(function (l) { if (getP(l.id).studied) doneLessons++; });
    var html = '<h1>Your subjects</h1><p class="lead">' +
      (totalLessons ? doneLessons + ' of ' + totalLessons + ' lessons studied.' :
        'No lessons yet. Drop files into a subject\'s <span class="path">materials</span> folder, then ask Claude to <strong>process new files</strong>.') +
      '</p>' +
      (DATA.generated ? '<p class="hint" style="margin:-14px 0 20px">Last updated ' + esc(formatDate(DATA.generated)) + '</p>' : '') +
      '<div class="grid">';
    SUBJECTS.forEach(function (s) {
      var p = subjectProgress(s);
      html += '<a class="card" href="#/subject/' + encodeURIComponent(s) + '">' +
        '<h3><span class="subject-dot" style="background:' + (SUBJECT_COLORS[s] || 'var(--accent)') + '"></span>' + esc(s) + '</h3>' +
        '<div class="meta">' + p.total + (p.total === 1 ? ' lesson' : ' lessons') + '</div>' +
        '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p.pct + '" aria-label="' + esc(s) + ' progress"><span style="width:' + p.pct + '%"></span></div>' +
        '<div class="bar-label"><span>' + (p.total ? p.done + ' of ' + p.total + ' studied' : 'Nothing yet') + '</span><span>' + p.pct + '%</span></div>' +
        '</a>';
    });
    app.innerHTML = html + '</div>';
  }

  function viewSubject(subject) {
    if (SUBJECTS.indexOf(subject) === -1) return viewNotFound();
    document.title = subject + ' — My Study Space';
    var ls = lessonsOf(subject), p = subjectProgress(subject);
    var html = '<div class="crumbs"><a href="#/">Home</a> / ' + esc(subject) + '</div>' +
      '<h1>' + esc(subject) + '</h1><p class="lead">' + p.total + (p.total === 1 ? ' lesson' : ' lessons') +
      (p.total ? ' · ' + p.done + ' studied (' + p.pct + '%)' : '') + '</p>';
    if (!ls.length) {
      html += '<div class="empty">No lessons here yet.<br>Put your files in <span class="path">' + esc(subject) +
        '/materials</span>, then tell Claude: <strong>process new files</strong>.</div>';
    } else {
      html += '<ul class="lesson-list">';
      ls.forEach(function (l) {
        var pr = getP(l.id);
        html += '<li><a class="lesson-row" href="#/lesson/' + encodeURIComponent(l.id) + '">' +
          '<div class="grow"><div class="title" ' + dirAttr(l) + '>' + esc(l.title) + '</div>' +
          '<div class="sub">' + (l.keyTerms || []).length + ' key terms · ' + questionCount(l) + ' questions</div></div>' +
          (isNew(l) ? '<span class="badge new">New</span>' : '') +
          (pr.best ? '<span class="badge score">Best ' + pr.best.score + '/' + pr.best.total + '</span>' : '') +
          (pr.studied ? '<span class="badge done">✓ Studied</span>' : '') +
          '</a></li>';
      });
      html += '</ul>';
    }
    app.innerHTML = html;
  }

  var TABS = [['summary', 'Summary'], ['kpis', 'KPIs'], ['terms', 'Key Terms'], ['quiz', 'Quiz'], ['flash', 'Flashcards']];

  function viewLesson(id, tab) {
    var l = getLesson(id);
    if (!l) return viewNotFound();
    if (isV2(l)) return viewLessonV2(l, tab);
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'summary';
    document.title = l.title + ' — My Study Space';
    var pr = getP(l.id), d = dirAttr(l);
    var html = '<div class="crumbs"><a href="#/">Home</a> / <a href="#/subject/' + encodeURIComponent(l.subject) + '">' + esc(l.subject) + '</a></div>' +
      '<div class="lesson-head' + (layoutDir(l) === 'dir="rtl"' ? ' rtl' : '') + '"><div><h1 ' + d + '>' + esc(l.title) +
      (isNew(l) ? ' <span class="badge new" dir="ltr" style="vertical-align:middle">New</span>' : '') + '</h1>' +
      (l.source ? '<p class="lead">From <span class="path">' + esc(fileName(l.source)) + '</span></p>' : '') + '</div>' +
      '<button class="btn small" type="button" data-action="toggle-studied" aria-pressed="' + pr.studied + '">' +
      (pr.studied ? '✓ Studied' : 'Mark as studied') + '</button></div>' +
      '<nav class="tabs" aria-label="Lesson sections">';
    TABS.forEach(function (t) {
      html += '<a class="tab' + (t[0] === tab ? ' active' : '') + '" href="#/lesson/' + encodeURIComponent(l.id) + '/' + t[0] + '"' +
        (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
    });
    if (l.source) {
      html += '<a class="tab ext" href="' + fileUrl(l.source) + '" target="_blank" rel="noopener" title="Opens your original file">Original file ↗</a>';
    }
    html += '</nav>';
    html += '<section id="tab-body"' + (layoutDir(l) === 'dir="rtl"' ? ' class="rtl-col"' : '') + '></section>';
    app.innerHTML = html;
    var body = document.getElementById('tab-body');
    if (tab === 'summary') body.innerHTML = tabSummary(l);
    else if (tab === 'kpis') body.innerHTML = tabKpis(l);
    else if (tab === 'terms') body.innerHTML = tabTerms(l);
    else if (tab === 'quiz') body.innerHTML = tabQuiz(l);
    else if (tab === 'flash') body.innerHTML = tabFlash(l);
    window.scrollTo(0, 0);
  }

  function tabSummary(l) {
    var d = dirAttr(l), html = '<div class="reading">';
    (l.summary || []).forEach(function (sec) {
      if (sec.heading) html += '<h2 ' + d + '>' + esc(sec.heading) + '</h2>';
      if (sec.text) html += '<p ' + d + '>' + rich(sec.text) + '</p>';
      if (sec.bullets && sec.bullets.length) {
        html += '<ul>';
        sec.bullets.forEach(function (b) { html += '<li ' + d + '>' + rich(b) + '</li>'; });
        html += '</ul>';
      }
    });
    return html + '</div>';
  }
  function tabKpis(l) {
    var d = dirAttr(l);
    var html = '<p class="lead">By the end of this lesson you should be able to:</p><ol class="kpi-list">';
    (l.kpis || []).forEach(function (k, i) { html += '<li ' + d + '><span class="n" dir="ltr">' + (i + 1) + '</span><span>' + rich(k) + '</span></li>'; });
    return html + '</ol>';
  }
  function tabTerms(l) {
    var d = dirAttr(l), html = '<dl class="terms">';
    (l.keyTerms || []).forEach(function (t) {
      html += '<div class="term"><dt ' + d + '>' + esc(t.term) + '</dt><dd ' + d + '>' + rich(t.definition) + '</dd></div>';
    });
    return html + '</dl>';
  }

  /* ================================================================
     Lesson page v2 — the redesigned 7-section layout. Used whenever
     a lesson has the new authoring fields (idea / examples / summaryCard).
     Reuses tabQuiz()/tabFlash() as-is inside the Practice section.
     ================================================================ */
  var V2_SECTIONS = [
    ['glance', '1. At a Glance'], ['idea', '2. The Idea'], ['explanation', '3. Full Explanation'],
    ['examples', '4. Worked Examples'], ['watch', '5. Watch'], ['practice', '6. Practice'], ['revise', '7. Revise']
  ];

  function viewLessonV2(l, section) {
    if (!V2_SECTIONS.some(function (s) { return s[0] === section; })) section = 'glance';
    document.title = l.title + ' — My Study Space';
    var pr = getP(l.id), d = dirAttr(l), rtl = layoutDir(l) === 'dir="rtl"';
    var html = '<div class="crumbs"><a href="#/">Home</a> / <a href="#/subject/' + encodeURIComponent(l.subject) + '">' + esc(l.subject) + '</a></div>' +
      '<div class="lesson-head' + (rtl ? ' rtl' : '') + '"><div><h1 ' + d + '>' + esc(l.title) +
      (isNew(l) ? ' <span class="badge new" dir="ltr" style="vertical-align:middle">New</span>' : '') + '</h1>' +
      (l.source ? '<p class="lead">From <span class="path">' + esc(fileName(l.source)) + '</span></p>' : '') + '</div>' +
      '<button class="btn small" type="button" data-action="toggle-studied" aria-pressed="' + pr.studied + '">' +
      (pr.studied ? '✓ Studied' : 'Mark as studied') + '</button></div>';
    html += '<nav class="section-nav" aria-label="Lesson sections">';
    V2_SECTIONS.forEach(function (s) {
      html += '<a' + (s[0] === section ? ' class="active"' : '') + ' href="#/lesson/' + encodeURIComponent(l.id) + '/' + s[0] + '">' + s[1] + '</a>';
    });
    if (l.source) html += '<a href="' + fileUrl(l.source) + '" target="_blank" rel="noopener" style="margin-inline-start:auto" title="Opens your original file">Original file ↗</a>';
    html += '</nav>';
    html += '<div class="v2' + (rtl ? ' rtl-col' : '') + '">';
    html += sectionGlance(l, pr, d);
    html += sectionIdea(l, d);
    html += sectionExplanation(l, d);
    html += sectionExamples(l, pr, d);
    html += sectionWatch(l, pr, d);
    html += sectionPractice(l, pr, d);
    html += sectionRevise(l, d);
    html += '</div>';
    app.innerHTML = html;
    if (section === 'glance') window.scrollTo(0, 0);
    else { var target = document.getElementById('section-' + section); if (target) target.scrollIntoView({ block: 'start' }); }
  }

  function sectionGlance(l, pr, d) {
    var meta = l.meta || {}, kpis = l.kpis || [], checked = pr.kpisChecked || [];
    var nChecked = checked.filter(Boolean).length;
    var html = '<section class="v2-section" id="section-glance"><h2><span class="num">1</span>At a Glance</h2><div class="glance-grid">' +
      '<div class="glance-stat"><div class="label">Time to study</div><div class="value">' + (meta.studyMinutes ? '~' + meta.studyMinutes + ' min' : '—') + '</div></div>' +
      '<div class="glance-stat"><div class="label">Difficulty</div><div class="value">' + difficultyDots(meta.difficulty) + '</div></div>' +
      '<div class="glance-stat"><div class="label">Your progress</div><div class="value">' + (pr.best ? 'Best ' + pr.best.score + '/' + pr.best.total : pr.studied ? '✓ Studied' : 'Not started') + '</div></div>' +
      '<div class="glance-stat"><div class="label">Objectives ticked</div><div class="value">' + nChecked + ' / ' + kpis.length + '</div></div>' +
      '</div>';
    if (meta.prerequisites && meta.prerequisites.length) {
      html += '<h3>You should already know</h3><ul class="prereq-list">';
      meta.prerequisites.forEach(function (p) { html += '<li ' + d + '>' + esc(p) + '</li>'; });
      html += '</ul>';
    }
    html += '<h3>Learning objectives</h3><ul class="checklist">';
    kpis.forEach(function (k, i) {
      var isChecked = !!checked[i];
      html += '<li class="' + (isChecked ? 'checked' : '') + '"><label>' +
        '<input type="checkbox" data-action="toggle-kpi" data-i="' + i + '"' + (isChecked ? ' checked' : '') + '>' +
        '<span class="kpi-text" ' + d + '>' + rich(k) + '</span></label></li>';
    });
    return html + '</ul></section>';
  }

  function sectionIdea(l, d) {
    var idea = l.idea || {};
    var html = '<section class="v2-section" id="section-idea"><h2><span class="num">2</span>The Idea in Simple Words</h2>';
    if (idea.simple) html += '<div class="idea-card simple"><div class="idea-label">In plain words</div><p ' + d + '>' + rich(idea.simple) + '</p></div>';
    if (idea.academic) html += '<div class="idea-card academic"><div class="idea-label">The proper version</div><p ' + d + '>' + rich(idea.academic) + '</p></div>';
    if (idea.analogy) html += '<div class="idea-card analogy"><div class="idea-label">Think of it like this</div><p ' + d + '>' + rich(idea.analogy) + '</p></div>';
    return html + '</section>';
  }

  function sectionExplanation(l, d) {
    var html = '<section class="v2-section" id="section-explanation"><h2><span class="num">3</span>Full Explanation</h2><div class="reading">';
    (l.explanation || l.summary || []).forEach(function (sec) {
      if (sec.heading) html += '<h3 ' + d + '>' + esc(sec.heading) + '</h3>';
      if (sec.text) html += '<p ' + d + '>' + rich(sec.text) + '</p>';
      if (sec.bullets && sec.bullets.length) {
        html += '<ul>';
        sec.bullets.forEach(function (b) { html += '<li ' + d + '>' + rich(b) + '</li>'; });
        html += '</ul>';
      }
      if (sec.box) {
        html += '<div class="info-box ' + esc(sec.box.type || 'rule') + '"><div class="box-label">' + esc(boxLabel(sec.box.type)) +
          (sec.box.title ? ': ' + esc(sec.box.title) : '') + '</div><div ' + d + '>' + rich(sec.box.content || '') + '</div></div>';
      }
      if (sec.diagram && sec.diagram.svg) {
        html += '<div class="diagram-box">' + sec.diagram.svg + (sec.diagram.caption ? '<div class="caption">' + esc(sec.diagram.caption) + '</div>' : '') + '</div>';
      }
    });
    html += '</div>';
    if ((l.keyTerms || []).length) {
      html += '<h3>Key terms <span class="hint" style="margin:0">(tap to see the definition)</span></h3><div class="term-chips">';
      l.keyTerms.forEach(function (t) {
        html += '<span class="term-chip"><button type="button" data-action="term-toggle" ' + d + '>' + esc(t.term) + '</button>' +
          '<span class="def-pop" ' + d + '>' + rich(t.definition) + '</span></span>';
      });
      html += '</div>';
    }
    return html + '</section>';
  }

  function sectionExamples(l, pr, d) {
    var examples = l.examples || [];
    var html = '<section class="v2-section" id="section-examples"><h2><span class="num">4</span>Worked Examples</h2>';
    if (!examples.length) return html + '<div class="empty">No worked examples yet.</div></section>';
    var revealed = pr.revealed || {};
    examples.forEach(function (ex, ei) {
      var n = revealed[ei] || 0, steps = ex.steps || [];
      html += '<div class="example"><div class="example-head"><h3 ' + d + '>' + esc(ex.title || ('Example ' + (ei + 1))) + '</h3>' +
        (ex.difficulty ? '<span class="diff-tag ' + esc(ex.difficulty) + '">' + esc(ex.difficulty) + '</span>' : '') + '</div>' +
        '<p class="problem" ' + d + '>' + rich(ex.problem || '') + '</p>';
      if (n === 0) {
        html += '<p class="hint">Try it yourself first, then reveal the steps one at a time.</p>' +
          '<div class="btn-row"><button class="btn primary" type="button" data-action="reveal-step" data-ex="' + ei + '">Show step 1</button></div>';
      } else {
        for (var s = 0; s < Math.min(n, steps.length); s++) {
          html += '<div class="step"><div class="step-n">Step ' + (s + 1) + '</div><div ' + d + '>' + rich(steps[s].explain || '') + '</div>' +
            (steps[s].work ? '<div class="work">' + esc(steps[s].work) + '</div>' : '') +
            (steps[s].why ? '<div class="why">Why this step? ' + rich(steps[s].why) + '</div>' : '') + '</div>';
        }
        if (n < steps.length) {
          html += '<div class="btn-row"><button class="btn primary" type="button" data-action="reveal-step" data-ex="' + ei + '">Show step ' + (n + 1) + '</button>' +
            '<button class="btn" type="button" data-action="reveal-all" data-ex="' + ei + '">Show all steps</button></div>';
        } else {
          html += '<div class="final-answer" ' + d + '>Answer: ' + rich(ex.answer || '') + '</div>' +
            '<div class="btn-row"><button class="btn small" type="button" data-action="reveal-reset" data-ex="' + ei + '">Hide steps again</button></div>';
        }
      }
      html += '</div>';
    });
    if ((l.commonMistakes || []).length) {
      html += '<div class="mistakes-box"><h3>Common mistakes</h3><ul>';
      l.commonMistakes.forEach(function (m) { html += '<li ' + d + '><strong>' + rich(m.mistake) + '</strong> — ' + rich(m.fix) + '</li>'; });
      html += '</ul></div>';
    }
    return html + '</section>';
  }

  function sectionWatch(l, pr, d) {
    var videos = l.videos || [];
    var html = '<section class="v2-section" id="section-watch"><h2><span class="num">5</span>Watch if You Didn\'t Understand</h2>';
    if (videos.length) {
      html += '<div class="video-grid">';
      videos.forEach(function (v) {
        html += '<div class="video-card"><a class="btn small primary" href="' + esc(youtubeSearchUrl(v.query)) + '" target="_blank" rel="noopener">Search YouTube ↗</a>' +
          '<div class="channel">Look for a channel like: <strong>' + esc(v.channel) + '</strong></div>' +
          '<p class="note" ' + d + '>' + rich(v.note || '') + '</p></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="empty">No suggested videos yet.</div>';
    }
    html += '<h3 style="margin-top:24px">Your saved videos</h3>';
    var mine = pr.myVideos || [];
    if (mine.length) {
      html += '<ul class="my-videos-list">';
      mine.forEach(function (v, i) {
        html += '<li><a href="' + esc(v.url) + '" target="_blank" rel="noopener">' + esc(v.note || v.url) + '</a>' +
          '<button class="icon-btn small" type="button" data-action="remove-video" data-i="' + i + '" aria-label="Remove saved video">&times;</button></li>';
      });
      html += '</ul>';
    } else {
      html += '<p class="hint" style="margin-top:0">If your teacher shares a video, paste the link here to save it with this lesson.</p>';
    }
    html += '<form class="my-video-form" data-action-form="add-video">' +
      '<input type="url" name="video-url" placeholder="Paste a video link" required>' +
      '<input type="text" name="video-note" placeholder="What is it? (optional)">' +
      '<button class="btn" type="submit">Save link</button></form>';
    return html + '</section>';
  }

  var quickRecallState = {}; // lessonId -> { items: [...], revealed: {i:true} } — cached so it doesn't reshuffle on every re-render
  function getQuickRecall(l) {
    if (!quickRecallState[l.id]) {
      var pool = [];
      lessonsOf(l.subject).forEach(function (other) {
        if (other.id === l.id) return;
        (((other.quiz || {}).multipleChoice) || []).forEach(function (q) { pool.push({ lessonTitle: other.title, q: q }); });
      });
      quickRecallState[l.id] = { items: shuffle(pool).slice(0, 5), revealed: {} };
    }
    return quickRecallState[l.id];
  }

  function sectionPractice(l, pr, d) {
    var html = '<section class="v2-section" id="section-practice"><h2><span class="num">6</span>Practice</h2>';
    html += '<h3>Quiz</h3>' + tabQuiz(l);
    html += '<h3 style="margin-top:36px">Flashcards</h3>' + tabFlash(l);
    var qr = getQuickRecall(l);
    if (qr.items.length) {
      html += '<h3 style="margin-top:36px">Quick recall — from earlier lessons in ' + esc(l.subject) + '</h3>';
      qr.items.forEach(function (item, i) {
        html += '<div class="quick-recall-item"><div class="from">From ' + esc(item.lessonTitle) + '</div>' +
          '<div ' + d + '>' + rich(item.q.question) + '</div>';
        if (qr.revealed[i]) {
          html += '<div class="answer-box" style="margin-top:10px"><p ' + d + '>' + rich(item.q.options[item.q.answer]) + '</p><p ' + d + '>' + rich(item.q.explanation) + '</p></div>';
        } else {
          html += '<div class="btn-row"><button class="btn small" type="button" data-action="qr-reveal" data-i="' + i + '">Show answer</button></div>';
        }
        html += '</div>';
      });
    }
    return html + '</section>';
  }

  function sectionRevise(l, d) {
    var sc = l.summaryCard || {};
    var html = '<section class="v2-section print-section" id="section-revise"><h2><span class="num">7</span>Summary to Revise From</h2><div class="summary-card">';
    if (sc.points && sc.points.length) {
      html += '<ul>'; sc.points.forEach(function (p) { html += '<li ' + d + '>' + rich(p) + '</li>'; }); html += '</ul>';
    }
    if (sc.mustNotForget && sc.mustNotForget.length) {
      html += '<div class="must-not-forget"><h3>5 things you must not forget</h3><ol>';
      sc.mustNotForget.forEach(function (p) { html += '<li ' + d + '>' + rich(p) + '</li>'; });
      html += '</ol></div>';
    }
    html += '</div><div class="btn-row no-print"><button class="btn primary" type="button" data-action="print-page">🖨 Print this page</button></div>';
    return html + '</section>';
  }

  /* ---------------- flashcards ---------------- */
  var flash = null; // {lessonId, order, pos}
  function tabFlash(l) {
    var terms = l.keyTerms || [];
    if (!terms.length) return '<div class="empty">This lesson has no key terms yet.</div>';
    if (!flash || flash.lessonId !== l.id) {
      flash = { lessonId: l.id, order: terms.map(function (_, i) { return i; }), pos: 0 };
    }
    var t = terms[flash.order[flash.pos]], d = dirAttr(l);
    return '<div class="flash-wrap">' +
      '<div class="hint" style="margin:0 0 12px">Card ' + (flash.pos + 1) + ' of ' + terms.length + '</div>' +
      '<button class="flashcard" type="button" data-action="flip" aria-label="Flashcard. Click to flip.">' +
      '<span class="inner">' +
      '<span class="face front"><span class="label">Term</span><span class="term-big" ' + d + '>' + esc(t.term) + '</span></span>' +
      '<span class="face back"><span class="label">Definition</span><span class="def" ' + d + '>' + rich(t.definition) + '</span></span>' +
      '</span></button>' +
      '<div class="flash-controls">' +
      '<button class="btn" type="button" data-action="flash-prev"' + (flash.pos === 0 ? ' disabled' : '') + '>← Previous</button>' +
      '<button class="btn" type="button" data-action="flash-shuffle">Shuffle</button>' +
      '<button class="btn primary" type="button" data-action="flash-next"' + (flash.pos === terms.length - 1 ? ' disabled' : '') + '>Next →</button>' +
      '</div><p class="hint">Click the card to flip it. Arrow keys also work.</p></div>';
  }

  /* ---------------- quiz ---------------- */
  var quiz = null; // {lessonId, mode, list, i, results, chosen, revealed, text, saved}
  var TYPE_LABEL = { mc: 'Multiple choice', sa: 'Short answer', ex: 'Exam-style' };

  function buildQuestions(l) {
    var q = l.quiz || {}, out = [];
    (q.multipleChoice || []).forEach(function (m, i) { out.push(Object.assign({ id: 'mc-' + i, type: 'mc' }, m)); });
    (q.shortAnswer || []).forEach(function (m, i) { out.push(Object.assign({ id: 'sa-' + i, type: 'sa' }, m)); });
    (q.examStyle || []).forEach(function (m, i) { out.push(Object.assign({ id: 'ex-' + i, type: 'ex' }, m)); });
    return out;
  }
  function startQuiz(l, mode) {
    var all = buildQuestions(l), list = all;
    if (mode === 'retry') {
      var wrong = getP(l.id).lastWrong;
      list = all.filter(function (q) { return wrong.indexOf(q.id) !== -1; });
      if (!list.length) list = all, mode = 'all';
    }
    quiz = { lessonId: l.id, mode: mode, list: list, i: 0, results: {}, chosen: null, revealed: false, text: '', saved: false };
  }

  function tabQuiz(l) {
    if (!quiz || quiz.lessonId !== l.id) {
      var all = buildQuestions(l), pr = getP(l.id);
      if (!all.length) return '<div class="empty">This lesson has no quiz yet.</div>';
      var missed = all.filter(function (q) { return pr.lastWrong.indexOf(q.id) !== -1; }).length;
      return '<div class="quiz panel">' +
        '<h2 style="margin-top:0">Ready to test yourself?</h2>' +
        '<p>' + all.length + ' questions: ' + (l.quiz.multipleChoice || []).length + ' multiple choice, ' +
        (l.quiz.shortAnswer || []).length + ' short answer, ' + (l.quiz.examStyle || []).length + ' exam-style. ' +
        'You get instant feedback after each one.</p>' +
        (pr.best ? '<p>Best score: <strong>' + pr.best.score + '/' + pr.best.total + '</strong> · Last: ' + pr.last.score + '/' + pr.last.total + ' · Attempts: ' + pr.attempts + '</p>' : '') +
        '<div class="btn-row"><button class="btn primary" type="button" data-action="quiz-start">Start quiz</button>' +
        (missed ? '<button class="btn" type="button" data-action="quiz-retry">Retry ' + missed + ' missed question' + (missed === 1 ? '' : 's') + '</button>' : '') +
        '</div></div>';
    }
    if (quiz.i >= quiz.list.length) return quizResult(l);
    return quizQuestion(l);
  }

  function quizQuestion(l) {
    var q = quiz.list[quiz.i], d = dirAttr(l), n = quiz.list.length;
    var html = '<div class="quiz">' +
      '<div class="quiz-top"><span>Question ' + (quiz.i + 1) + ' of ' + n + (quiz.mode === 'retry' ? ' · retrying missed' : '') + '</span><span class="qtype">' + TYPE_LABEL[q.type] + '</span></div>' +
      '<div class="bar"><span style="width:' + Math.round(100 * quiz.i / n) + '%"></span></div>' +
      '<div class="question" ' + d + '>' + rich(q.question) + '</div>';
    if (q.type === 'mc') {
      var locked = quiz.chosen !== null;
      html += '<div class="options">';
      q.options.forEach(function (opt, i) {
        var cls = 'option';
        if (locked && i === q.answer) cls += ' correct';
        else if (locked && i === quiz.chosen) cls += ' wrong';
        html += '<button type="button" class="' + cls + '" data-action="choose" data-i="' + i + '" ' + d + (locked ? ' disabled' : '') + '>' +
          '<span class="key" dir="ltr">' + String.fromCharCode(65 + i) + '</span><span>' + rich(opt) + '</span></button>';
      });
      html += '</div>';
      if (locked) {
        var ok = quiz.chosen === q.answer;
        html += '<div class="feedback ' + (ok ? 'good' : 'bad') + '" role="status"><strong class="head">' +
          (ok ? '✓ Correct' : '✗ Not quite — the answer is ' + String.fromCharCode(65 + q.answer)) + '</strong><span ' + d + '>' + rich(q.explanation) + '</span></div>' +
          '<div class="btn-row"><button class="btn primary" type="button" data-action="quiz-next">' + (quiz.i === n - 1 ? 'See results' : 'Next question →') + '</button></div>';
      }
    } else {
      html += '<textarea class="answer" id="typed" ' + d + ' placeholder="Write your answer here (optional), then check it against the model answer." ' + (quiz.revealed ? 'readonly' : '') + '>' + esc(quiz.text) + '</textarea>';
      if (!quiz.revealed) {
        html += '<div class="btn-row"><button class="btn primary" type="button" data-action="reveal">Show model answer</button></div>';
      } else {
        html += '<div class="answer-box"><h4>Model answer</h4><p ' + d + '>' + rich(q.answer) + '</p>' +
          '<h4 style="margin-top:12px">Why</h4><p ' + d + '>' + rich(q.explanation) + '</p></div>' +
          '<p style="margin:16px 0 0"><strong>How did you do?</strong></p>' +
          '<div class="btn-row" style="margin-top:8px"><button class="btn primary" type="button" data-action="grade" data-ok="1">✓ I got it</button>' +
          '<button class="btn" type="button" data-action="grade" data-ok="0">✗ Not quite</button></div>';
      }
    }
    return html + '</div>';
  }

  function quizResult(l) {
    var d = dirAttr(l), list = quiz.list, score = 0, wrong = [];
    list.forEach(function (q) { if (quiz.results[q.id]) score++; else wrong.push(q); });
    var total = list.length, pct = Math.round(100 * score / total);
    if (!quiz.saved) {
      quiz.saved = true;
      var pr = getP(l.id), patch = { lastWrong: wrong.map(function (q) { return q.id; }) };
      if (quiz.mode === 'all') {
        patch.last = { score: score, total: total, date: new Date().toISOString() };
        if (!pr.best || score / total > pr.best.score / pr.best.total) patch.best = patch.last;
        patch.attempts = pr.attempts + 1;
        if (pct >= PASS_PCT) patch.studied = true;
      }
      setP(l.id, patch);
    }
    var msg = pct === 100 ? 'Perfect — every answer right.' : pct >= PASS_PCT ? 'Solid work. Review the ones you missed.' : 'Keep going — retry the missed ones and re-read the summary.';
    var html = '<div class="quiz"><div class="panel" style="text-align:center">' +
      '<div class="qtype">' + (quiz.mode === 'retry' ? 'Retry round' : 'Quiz complete') + '</div>' +
      '<div class="score-big" dir="ltr">' + score + ' / ' + total + '</div><p style="margin:.2em 0 0">' + pct + '% — ' + msg + '</p>' +
      '<div class="btn-row" style="justify-content:center">' +
      (wrong.length ? '<button class="btn primary" type="button" data-action="quiz-retry">Retry only the ' + wrong.length + ' I got wrong</button>' : '') +
      '<button class="btn" type="button" data-action="quiz-start">Retake whole quiz</button></div></div>';
    if (wrong.length) {
      html += '<h2>Review: questions you missed</h2><div class="panel">';
      wrong.forEach(function (q) {
        var ans = q.type === 'mc' ? q.options[q.answer] : q.answer;
        html += '<div class="review-item"><div ' + d + '><strong>' + rich(q.question) + '</strong></div>' +
          '<div class="answer-box"><h4>Answer</h4><p ' + d + '>' + rich(ans) + '</p><p ' + d + '>' + rich(q.explanation) + '</p></div></div>';
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  /* ---------------- search / not found ---------------- */
  function viewSearch(q) {
    document.title = 'Search — My Study Space';
    var input = document.getElementById('search-input');
    if (input && document.activeElement !== input) input.value = q;
    var html = '<h1>Search</h1>';
    if (!q.trim()) { app.innerHTML = html + '<p class="lead">Type something in the search box above.</p>'; return; }
    var res = runSearch(q), hits = res.hits || [];
    html += '<p class="lead">' + hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for “' + esc(q) + '”' + (hits.length > 60 ? ' (showing the first 60)' : '') + '</p>';
    if (!hits.length) html += '<div class="empty">Nothing found. Try a different word.</div>';
    hits.slice(0, 60).forEach(function (h) {
      var e = h.e;
      html += '<a class="result" href="#/lesson/' + encodeURIComponent(e.lesson.id) + '/' + e.tab + '">' +
        '<div class="where">' + esc(e.lesson.subject) + ' › ' + esc(e.lesson.title) + ' › ' + esc(e.label) + '</div>' +
        '<div ' + dirAttr(e.lesson) + '>' + highlight(e, res.words) + '</div></a>';
    });
    app.innerHTML = html;
  }
  function viewNotFound() {
    document.title = 'Not found — My Study Space';
    app.innerHTML = '<h1>Page not found</h1><p class="lead">That page doesn\'t exist. <a href="#/">Back to home</a>.</p>';
  }

  /* ---------------- router ---------------- */
  function route() {
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    var head = parts[0];
    if (head === 'lesson' && parts[1]) {
      if (quiz && quiz.lessonId !== parts[1]) quiz = null;
      viewLesson(parts[1], parts[2] || 'summary');
      return; // v1 scrolls to top itself; v2 scrolls to the requested section — see viewLesson/viewLessonV2
    } else if (head === 'subject' && parts[1]) viewSubject(parts[1]);
    else if (head === 'search') viewSearch(parts.slice(1).join('/'));
    else if (!head) viewHome();
    else viewNotFound();
    window.scrollTo(0, 0);
  }
  function rerenderLesson() {
    var m = (location.hash || '').match(/^#\/lesson\/([^/]+)(?:\/([^/]+))?/);
    if (!m) return;
    var y = window.scrollY;
    viewLesson(decodeURIComponent(m[1]), m[2] || 'summary');
    window.scrollTo(0, y);
  }

  /* ---------------- events ---------------- */
  function currentLesson() {
    var m = (location.hash || '').match(/^#\/lesson\/([^/]+)/);
    return m ? getLesson(decodeURIComponent(m[1])) : null;
  }
  function advance() { quiz.i++; quiz.chosen = null; quiz.revealed = false; quiz.text = ''; rerenderLesson(); }

  app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action'), l = currentLesson();
    if (!l) return;
    if (act === 'toggle-studied') {
      setP(l.id, { studied: !getP(l.id).studied }); rerenderLesson();
    } else if (act === 'flip') {
      el.classList.toggle('flipped');
    } else if (act === 'flash-next' || act === 'flash-prev') {
      flash.pos += act === 'flash-next' ? 1 : -1; rerenderLesson();
    } else if (act === 'flash-shuffle') {
      flash.order = shuffle(flash.order); flash.pos = 0; rerenderLesson();
    } else if (act === 'quiz-start') {
      startQuiz(l, 'all'); rerenderLesson();
    } else if (act === 'quiz-retry') {
      startQuiz(l, 'retry'); rerenderLesson();
    } else if (act === 'choose' && quiz && quiz.chosen === null) {
      var q = quiz.list[quiz.i], i = +el.getAttribute('data-i');
      quiz.chosen = i; quiz.results[q.id] = (i === q.answer); rerenderLesson();
    } else if (act === 'quiz-next') {
      advance();
    } else if (act === 'reveal') {
      var ta = document.getElementById('typed'); if (ta) quiz.text = ta.value;
      quiz.revealed = true; rerenderLesson();
    } else if (act === 'grade') {
      quiz.results[quiz.list[quiz.i].id] = el.getAttribute('data-ok') === '1'; advance();
    } else if (act === 'toggle-kpi') {
      var checkedArr = (getP(l.id).kpisChecked || []).slice(), ki = +el.getAttribute('data-i');
      checkedArr[ki] = !checkedArr[ki];
      setP(l.id, { kpisChecked: checkedArr }); rerenderLesson();
    } else if (act === 'term-toggle') {
      var chip = el.closest('.term-chip'); if (chip) chip.classList.toggle('open');
    } else if (act === 'reveal-step') {
      var ei = +el.getAttribute('data-ex');
      var rv = Object.assign({}, getP(l.id).revealed); rv[ei] = (rv[ei] || 0) + 1;
      setP(l.id, { revealed: rv }); rerenderLesson();
    } else if (act === 'reveal-all') {
      var ei2 = +el.getAttribute('data-ex');
      var steps2 = ((l.examples || [])[ei2] || {}).steps || [];
      var rv2 = Object.assign({}, getP(l.id).revealed); rv2[ei2] = steps2.length;
      setP(l.id, { revealed: rv2 }); rerenderLesson();
    } else if (act === 'reveal-reset') {
      var ei3 = +el.getAttribute('data-ex');
      var rv3 = Object.assign({}, getP(l.id).revealed); rv3[ei3] = 0;
      setP(l.id, { revealed: rv3 }); rerenderLesson();
    } else if (act === 'remove-video') {
      var vi = +el.getAttribute('data-i');
      var vids = (getP(l.id).myVideos || []).slice(); vids.splice(vi, 1);
      setP(l.id, { myVideos: vids }); rerenderLesson();
    } else if (act === 'qr-reveal') {
      var qr = getQuickRecall(l); qr.revealed[el.getAttribute('data-i')] = true; rerenderLesson();
    } else if (act === 'print-page') {
      window.print();
    }
  });

  app.addEventListener('submit', function (ev) {
    var form = ev.target.closest('[data-action-form="add-video"]');
    if (!form) return;
    ev.preventDefault();
    var l = currentLesson(); if (!l) return;
    var urlInput = form.querySelector('input[name="video-url"]'), noteInput = form.querySelector('input[name="video-note"]');
    var url = urlInput.value.trim();
    if (!/^https?:\/\//i.test(url)) { urlInput.focus(); return; }
    var vids = (getP(l.id).myVideos || []).slice();
    vids.push({ url: url, note: noteInput.value.trim() });
    setP(l.id, { myVideos: vids });
    rerenderLesson();
  });

  document.addEventListener('keydown', function (ev) {
    var tag = ev.target && ev.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var l = currentLesson(); if (!l) return;
    var tab = (location.hash.match(/^#\/lesson\/[^/]+\/([^/]+)/) || [])[1];
    if ((tab === 'flash' || tab === 'practice') && flash) {
      var b = ev.key === 'ArrowRight' ? app.querySelector('[data-action="flash-next"]') :
              ev.key === 'ArrowLeft' ? app.querySelector('[data-action="flash-prev"]') : null;
      if (b && !b.disabled) { ev.preventDefault(); b.click(); }
    } else if ((tab === 'quiz' || tab === 'practice') && quiz && quiz.i < quiz.list.length) {
      var q = quiz.list[quiz.i];
      if (q.type === 'mc' && quiz.chosen === null && /^[1-9]$/.test(ev.key) && +ev.key <= q.options.length) {
        var o = app.querySelector('[data-action="choose"][data-i="' + (+ev.key - 1) + '"]'); if (o) o.click();
      } else if (q.type === 'mc' && quiz.chosen !== null && ev.key === 'Enter' && ev.target === document.body) {
        advance();
      }
    }
  });

  app.addEventListener('input', function (ev) {
    if (ev.target.id === 'typed' && quiz) quiz.text = ev.target.value;
  });

  document.getElementById('search-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    location.hash = '#/search/' + encodeURIComponent(document.getElementById('search-input').value);
  });
  document.getElementById('search-input').addEventListener('input', function (ev) {
    var v = ev.target.value;
    if (v.trim().length >= 2) { history.replaceState(null, '', '#/search/' + encodeURIComponent(v)); viewSearch(v); }
  });

  document.getElementById('theme-btn').addEventListener('click', function () {
    var root = document.documentElement, cur = root.getAttribute('data-theme');
    if (!cur) cur = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('study.theme', next); } catch (e) {}
  });

  /* ---------------- check for updates (hosted copy only; harmless no-op on file://) ---------------- */
  var updateCheckDone = false;
  function checkForUpdates() {
    if (!window.fetch || !DATA.generated) return;
    fetch('data/version.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (v && v.generated && v.generated !== DATA.generated) {
          document.getElementById('update-banner').hidden = false;
        }
      })
      .catch(function () { /* offline, file://, or no version.json yet — ignore */ });
  }
  document.getElementById('update-refresh').addEventListener('click', function () { location.reload(); });
  document.getElementById('update-dismiss').addEventListener('click', function () {
    document.getElementById('update-banner').hidden = true;
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkForUpdates();
  });
  window.addEventListener('focus', checkForUpdates);

  window.addEventListener('hashchange', route);
  route();
  checkForUpdates();
})();
