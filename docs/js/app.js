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
    return { studied: !!p.studied, best: p.best || null, last: p.last || null, attempts: p.attempts || 0, lastWrong: p.lastWrong || [] };
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
      add('summary', 'Lesson title', l.title);
      (l.summary || []).forEach(function (sec) {
        add('summary', 'Summary', (sec.heading ? sec.heading + ' — ' : '') + (sec.text || '') + ' ' + (sec.bullets || []).join(' · '));
      });
      (l.kpis || []).forEach(function (k) { add('kpis', 'KPI', k); });
      (l.keyTerms || []).forEach(function (t) { add('terms', 'Key term', t.term + ' — ' + t.definition); });
      var q = l.quiz || {};
      (q.multipleChoice || []).forEach(function (m) { add('quiz', 'Quiz', m.question + ' ' + (m.options || []).join(' | ')); });
      (q.shortAnswer || []).forEach(function (m) { add('quiz', 'Quiz', m.question); });
      (q.examStyle || []).forEach(function (m) { add('quiz', 'Quiz', m.question); });
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
    }
  });

  document.addEventListener('keydown', function (ev) {
    var tag = ev.target && ev.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var l = currentLesson(); if (!l) return;
    var tab = (location.hash.match(/^#\/lesson\/[^/]+\/([^/]+)/) || [])[1];
    if (tab === 'flash' && flash) {
      var b = ev.key === 'ArrowRight' ? app.querySelector('[data-action="flash-next"]') :
              ev.key === 'ArrowLeft' ? app.querySelector('[data-action="flash-prev"]') : null;
      if (b && !b.disabled) { ev.preventDefault(); b.click(); }
    } else if (tab === 'quiz' && quiz && quiz.i < quiz.list.length) {
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
