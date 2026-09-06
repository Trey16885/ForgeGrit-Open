/* ForgeGrit Open — tiny Markdown -> HTML renderer.
   Enough for model READMEs: headings, tables, fenced code, lists,
   blockquotes, rules, links, bold/italic/inline code. No dependencies. */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeHref(url) {
    var u = url.trim();
    if (/^(javascript|data|vbscript):/i.test(u)) return '#';
    return esc(u);
  }

  // Inline formatting. Input must already be HTML-escaped.
  function inline(text) {
    var codes = [];
    var out = text.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return '@@FGCODE' + (codes.length - 1) + '@@';
    });

    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
      return '<img src="' + safeHref(src) + '" alt="' + alt + '">';
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      return '<a href="' + safeHref(href) + '">' + label + '</a>';
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return out.replace(/@@FGCODE(\d+)@@/g, function (_, i) {
      return '<code>' + codes[+i] + '</code>';
    });
  }

  function splitRow(line) {
    // A pipe escaped as \| belongs to the cell, not to the table.
    return line
      .replace(/\\\|/g, '@@FGPIPE@@')
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map(function (c) { return c.trim().split('@@FGPIPE@@').join('|'); });
  }

  function isDivider(line) {
    return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.indexOf('-') !== -1;
  }

  function render(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var para = [];
    var i = 0;

    function flushPara() {
      if (!para.length) return;
      // Soft wraps collapse to spaces; two trailing spaces force a break.
      var text = inline(esc(para.join('\n')))
        .replace(/ {2,}\n/g, '<br>')
        .replace(/\n/g, ' ');
      html.push('<p>' + text + '</p>');
      para = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      // fenced code
      var fence = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(line);
      if (fence) {
        flushPara();
        var marker = fence[1];
        var lang = fence[2];
        var body = [];
        i++;
        var closer = new RegExp('^\\s*' + marker[0] + '{' + marker.length + ',}\\s*$');
        while (i < lines.length && !closer.test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++; // closing fence
        html.push(
          '<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
          esc(body.join('\n')) + '</code></pre>'
        );
        continue;
      }

      // table
      if (/\|/.test(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
        flushPara();
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var t = ['<table><thead><tr>'];
        head.forEach(function (c) { t.push('<th>' + inline(esc(c)) + '</th>'); });
        t.push('</tr></thead><tbody>');
        rows.forEach(function (r) {
          t.push('<tr>');
          for (var c = 0; c < head.length; c++) {
            t.push('<td>' + inline(esc(r[c] || '')) + '</td>');
          }
          t.push('</tr>');
        });
        t.push('</tbody></table>');
        html.push(t.join(''));
        continue;
      }

      // heading
      var head6 = /^(#{1,6})\s+(.*)$/.exec(line);
      if (head6) {
        flushPara();
        var lvl = head6[1].length;
        html.push('<h' + lvl + '>' + inline(esc(head6[2].trim())) + '</h' + lvl + '>');
        i++;
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
        flushPara();
        html.push('<hr>');
        i++;
        continue;
      }

      // blockquote
      if (/^\s*>\s?/.test(line)) {
        flushPara();
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html.push('<blockquote>' + render(quote.join('\n')) + '</blockquote>');
        continue;
      }

      // lists
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        flushPara();
        var ordered = /^\s*\d+\.\s+/.test(line);
        var items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          var item = [lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '')];
          i++;
          // continuation lines belonging to the same item
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            item.push(lines[i].trim());
            i++;
          }
          items.push(inline(esc(item.join(' '))));
        }
        var tag = ordered ? 'ol' : 'ul';
        html.push('<' + tag + '>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</' + tag + '>');
        continue;
      }

      if (line.trim() === '') {
        flushPara();
        i++;
        continue;
      }

      para.push(line);
      i++;
    }

    flushPara();
    return html.join('\n');
  }

  global.ForgeMarkdown = { render: render, escape: esc };
})(typeof window !== 'undefined' ? window : globalThis);
