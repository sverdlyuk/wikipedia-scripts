/* скрипт автоматичного оновлення міжновних посилань. */
(function () {
    'use strict';
    if (mw.config.get('wgNamespaceNumber') !== 0 || !mw.config.get('wgArticleId')) return;

    mw.loader.using('mediawiki.util').then(function () {
        $(function () {
            if (document.getElementById('t-refresh-interlanguage-links')) return;
            var button = mw.util.addPortletLink('p-tb', '#',
                'Оновити кеш міжмовних посилань', 't-refresh-interlanguage-links',
                'Оновити кеш мовних версій цієї статті');
            if (!button) return;
            var busy = false;
            var sleep = function (ms) {
                return new Promise(function (resolve) {
                    setTimeout(resolve, ms);
                });
            };

            async function request(endpoint, params, post) {
                var body = new URLSearchParams(Object.assign({
                    format: 'json', origin: '*', maxlag: '5'
                }, params));
                for (var attempt = 0; attempt < 3; attempt++) {
                    var controller = new AbortController();
                    var timer = setTimeout(function () {
                        controller.abort();
                    }, 30000);
                    try {
                        var response = await fetch(endpoint + (post ? '' : '?' + body), {
                            method: post ? 'POST' : 'GET',
                            body: post ? body : undefined,
                            credentials: 'omit',
                            signal: controller.signal
                        });
                        var data = response.ok ? await response.json() : null;
                        var retry = response.status === 429 || response.status === 503 ||
                            (data && data.error &&
                                ['maxlag', 'ratelimited'].includes(data.error.code));
                        if (retry && attempt < 2) {
                            clearTimeout(timer);
                            var delay = Number(response.headers.get('Retry-After'));
                            await sleep(
                                Math.max(5 * Math.pow(2, attempt), delay || 0) * 1000
                            );
                            continue;
                        }
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        if (data.error) {
                            throw new Error(data.error.info || data.error.code);
                        }
                        return data;
                    } finally {
                        clearTimeout(timer);
                    }
                }
            }

            button.addEventListener('click', async function (event) {
                event.preventDefault();
                if (busy) return;
                busy = true;
                var status = document.createElement('div');
                status.setAttribute('role', 'status');
                status.textContent = 'Отримую мовні версії з Wikidata…';
                mw.notify(status, {
                    autoHide: false,
                    tag: 'refresh-interlanguage-links'
                });

                try {
                    // Шукаємо за поточною назвою, навіть якщо сторінка
                    // ще не знає свій Q-номер.
                    var data = await request('https://www.wikidata.org/w/api.php', {
                        action: 'wbgetentities',
                        sites: mw.config.get('wgDBname'),
                        titles: mw.config.get('wgPageName').replace(/_/g, ' '),
                        props: 'sitelinks/urls'
                    }, false);

                    var entity = Object.values(data.entities || {}).find(function (item) {
                        return item.sitelinks;
                    });
                    if (!entity) {
                        throw new Error(
                            'Цю статтю ще не приєднано до елемента Wikidata.'
                        );
                    }

                    var pages = Object.values(entity.sitelinks).filter(function (link) {
                        if (!link.url) return false;
                        var url = new URL(link.url);
                        return url.protocol === 'https:' &&
                            /^[a-z0-9-]+\.wikipedia\.org$/.test(url.hostname);
                    });
                    if (!pages.length) {
                        throw new Error('Мовних версій Вікіпедії не знайдено.');
                    }

                    var success = 0;
                    var errors = [];

                    for (var i = 0; i < pages.length; i++) {
                        var page = pages[i];
                        status.textContent = 'Оновлюю ' + (i + 1) + '/' +
                            pages.length + ': ' + page.site;

                        try {
                            var result = await request(
                                new URL(page.url).origin + '/w/api.php',
                                {
                                    action: 'purge',
                                    titles: page.title
                                },
                                true
                            );

                            if (!result.purge || !result.purge.some(function (item) {
                                return Object.prototype.hasOwnProperty.call(
                                    item, 'purged'
                                );
                            })) {
                                throw new Error(
                                    'Сервер не підтвердив очищення кешу.'
                                );
                            }
                            success++;
                        } catch (error) {
                            errors.push(page.site + ': ' + error.message);
                        }

                        if (i + 1 < pages.length) await sleep(1000);
                    }

                    status.textContent = 'Готово: кеш оновлено для ' + success +
                        ' із ' + pages.length +
                        ' сторінок. Перезавантажте сторінку, щоб побачити зміни.';

                    if (errors.length) {
                        var details = document.createElement('details');
                        var summary = document.createElement('summary');
                        summary.textContent = 'Не вдалося оновити: ' + errors.length;
                        details.appendChild(summary);

                        var list = document.createElement('ul');
                        errors.forEach(function (message) {
                            var item = document.createElement('li');
                            item.textContent = message;
                            list.appendChild(item);
                        });

                        details.appendChild(list);
                        status.appendChild(details);
                    }
                } catch (error) {
                    status.textContent = 'Не вдалося оновити: ' + error.message;
                } finally {
                    busy = false;
                }
            });
        });
    });
}());
