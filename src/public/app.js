const $ = (id) => document.getElementById(id);

const etatUI = {
  vue: 'unites', // unites | fichiers | supprimer
  chemin: [], // segments du dossier courant (vue fichiers)
  lignes: [],
  total: 0, // vue unités : nombre d'unités correspondant aux filtres
  taille: 0,
  selection: null,
  notes: {}, // chemin relatif -> 1..5
  memos: {}, // chemin relatif -> texte libre (à quoi ça sert)
  jetonDetails: 0, // évite qu'un résumé tardif écrase le panneau d'une autre sélection
  cochees: new Set(), // vue « à supprimer » : chemins qui partiront à la Corbeille
};
// Requêtes qui modifient quelque chose : l'en-tête prouve qu'elles viennent de cette page
const envoyer = (url, methode, corps) => fetch(url, {
  method: methode,
  headers: { 'X-Nettoyeur': '1' },
  body: corps ? JSON.stringify(corps) : undefined,
});

const notesChargees = Promise.all([
  fetch('/api/notes').then((r) => r.json()).then((n) => { etatUI.notes = n; }),
  fetch('/api/memos').then((r) => r.json()).then((m) => { etatUI.memos = m; }),
]);
const resumes = new Map(); // chemin -> résumé déjà calculé
const apercus = new Map(); // chemin -> élément « aperçu » de sa ligne, pour le mettre à jour sans tout redessiner

// Cinq étoiles cliquables ; recliquer sur la note actuelle la retire
const widgetsEtoiles = new Set(); // pour synchroniser ligne et panneau de détails

function etoiles(chemin) {
  const zone = el('span', { className: 'etoiles' });
  const synchroniser = () => {
    for (const w of widgetsEtoiles) {
      if (!w.zone.isConnected) widgetsEtoiles.delete(w);
      else if (w.chemin === chemin) w.dessiner();
    }
  };
  const dessiner = () => {
    const note = etatUI.notes[chemin] ?? 0;
    zone.replaceChildren(...[1, 2, 3, 4, 5].map((n) => el('button', {
      className: n <= note ? 'on' : '',
      textContent: '★',
      title: n === note ? 'Retirer la note' : `${n} / 5`,
      onclick: async (ev) => {
        ev.stopPropagation(); // ne sélectionne pas la ligne
        const nouvelle = n === note ? 0 : n;
        const precedente = etatUI.notes[chemin];
        if (nouvelle) etatUI.notes[chemin] = nouvelle; else delete etatUI.notes[chemin];
        synchroniser();
        const rep = await envoyer('/api/notes', 'PUT', { chemin, note: nouvelle }).catch(() => null);
        if (!rep?.ok) { // sauvegarde échouée : on revient en arrière
          if (precedente) etatUI.notes[chemin] = precedente; else delete etatUI.notes[chemin];
          synchroniser();
          alert('La note n’a pas pu être enregistrée.');
        }
      },
    })));
  };
  dessiner();
  widgetsEtoiles.add({ chemin, zone, dessiner });
  return zone;
}

// Crée un élément en toute sécurité (les noms de fichiers ne passent jamais par innerHTML)
function el(tag, props = {}, ...enfants) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...enfants.filter((c) => c != null));
  return e;
}

const formatTaille = (o) => {
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (o >= 1024 && i < u.length - 1) { o /= 1024; i++; }
  return `${o.toFixed(i && o < 100 ? 1 : 0)} ${u[i]}`;
};
const formatDate = (ms) => (ms ? new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const extension = (nom) => (nom.includes('.') && !nom.startsWith('.') ? nom.slice(nom.lastIndexOf('.')).toLowerCase() : '');

function libelleType(l) {
  if (l.protege) return 'Dossier protégé';
  if (l.projet) return `Projet ${l.projet.technos.join(', ') || 'git'}`;
  if (l.type === 'dossier') return 'Dossier';
  if (l.type === 'lien') return 'Lien';
  return extension(l.nom) ? `Fichier ${extension(l.nom)}` : 'Fichier';
}

// ---------- Scan ----------
// Met à jour la ligne de résumé en haut de page
async function majResume() {
  const e = await (await fetch('/api/scan')).json();
  $('resume').textContent = e.etat === 'inactif' ? 'Aucun scan lancé.'
    : `${e.fichiers.toLocaleString('fr')} fichiers, ${e.dossiers.toLocaleString('fr')} dossiers, ${e.unites.toLocaleString('fr')} unités, ${formatTaille(e.taille)}` +
      (e.erreurs ? ` (${e.erreurs} inaccessibles)` : '');
  return e;
}

async function suivreScan() {
  const e = await majResume();
  $('courant').textContent = e.courant;
  if (e.etat === 'en-cours') {
    $('scan').disabled = true;
    return setTimeout(suivreScan, 500);
  }
  $('scan').disabled = false;
  if (e.etat === 'termine') {
    $('resume').textContent += ` — scanné en ${((e.fin - e.debut) / 1000).toFixed(1)} s`;
    $('app').hidden = false;
    etatUI.chemin = [];
    charger();
  }
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true;
  await envoyer('/api/scan', 'POST');
  suivreScan();
});

// ---------- Chargement des lignes ----------
// Vue unités : le serveur filtre, trie et pagine (plusieurs milliers d'unités)
async function chargerUnites(ajout) {
  const p = new URLSearchParams({
    genre: $('genre').value, statut: $('statut').value, tri: $('tri').value,
    dans: $('dans').value, limite: 500, debut: ajout ? etatUI.lignes.length : 0,
  });
  const d = await (await fetch(`/api/unites?${p}`)).json();
  etatUI.lignes = ajout ? [...etatUI.lignes, ...d.elements] : d.elements;
  etatUI.total = d.total;
  etatUI.taille = d.taille;
}

async function charger(ajout = false) {
  if (!ajout) {
    etatUI.selection = null;
    afficherDetails(null);
  }
  $('filtres').hidden = etatUI.vue !== 'unites';
  $('suppression').hidden = etatUI.vue !== 'supprimer';
  $('option-tri').hidden = etatUI.vue === 'supprimer'; // cette liste est triée par note
  $('tri').querySelector('[value=type]').hidden = etatUI.vue === 'unites'; // tri par type : vue fichiers seulement
  if ($('tri').value === 'type' && etatUI.vue === 'unites') $('tri').value = 'taille';
  $('resultat').hidden = true;
  await notesChargees;

  if (etatUI.vue === 'unites') {
    await chargerUnites(ajout);
  } else if (etatUI.vue === 'supprimer') {
    const d = await (await fetch(`/api/a-supprimer?seuil=${$('seuil').value}`)).json();
    etatUI.lignes = d.elements;
    etatUI.cochees = new Set(d.elements.map((e) => e.chemin)); // tout est coché, à toi de décocher
  } else {
    const rel = etatUI.chemin.join('/');
    const d = await (await fetch(`/api/dossier?chemin=${encodeURIComponent(rel)}`)).json();
    etatUI.lignes = (d.enfants ?? []).map((e) => ({ ...e, chemin: [...etatUI.chemin, e.nom].join('/') }));
  }
  afficherFil();
  afficherListe();
  afficherBilan();
  $('suite').hidden = !(etatUI.vue === 'unites' && etatUI.lignes.length < etatUI.total);
}

// ---------- Fil d'Ariane ----------
function afficherFil() {
  const fil = $('fil');
  fil.replaceChildren();
  if (etatUI.vue === 'unites') {
    fil.append(el('span', { textContent: `${etatUI.total.toLocaleString('fr')} unités — ${formatTaille(etatUI.taille)}` +
      (etatUI.lignes.length < etatUI.total ? ` (${etatUI.lignes.length.toLocaleString('fr')} affichées)` : '') }));
    return;
  }
  if (etatUI.vue === 'supprimer') {
    fil.append(el('span', { textContent: `${etatUI.lignes.length} éléments` }));
    return;
  }
  const aller = (n) => { etatUI.chemin = etatUI.chemin.slice(0, n); charger(); };
  fil.append(el('a', { textContent: '~ (dossier personnel)', onclick: () => aller(0) }));
  etatUI.chemin.forEach((seg, i) => {
    fil.append(el('span', { textContent: ' / ' }), el('a', { textContent: seg, onclick: () => aller(i + 1) }));
  });
}

// ---------- Liste triée ----------
function trier(lignes) {
  if (etatUI.vue !== 'fichiers') return lignes; // déjà triées par le serveur
  const cle = $('tri').value;
  const copie = [...lignes];
  if (cle === 'nom') return copie.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (cle === 'note') return copie.sort((a, b) => (etatUI.notes[b.chemin] ?? 0) - (etatUI.notes[a.chemin] ?? 0) || b.taille - a.taille);
  if (cle === 'type') return copie.sort((a, b) => libelleType(a).localeCompare(libelleType(b), 'fr') || b.taille - a.taille);
  return copie.sort((a, b) => (b[cle] ?? 0) - (a[cle] ?? 0));
}

// Ligne sous le nom : ton mémo s'il existe, sinon la description du projet
function majApercu(l) {
  const apercu = apercus.get(l.chemin);
  if (!apercu) return;
  const memo = etatUI.memos[l.chemin];
  apercu.textContent = memo ? `✎ ${memo}` : (l.projet?.description ?? '');
  apercu.classList.toggle('memo', Boolean(memo));
}

function afficherListe() {
  apercus.clear();
  const lignes = trier(etatUI.lignes);
  const max = Math.max(1, ...lignes.map((l) => l.taille));
  const corps = $('liste');
  corps.replaceChildren();
  $('vide').hidden = lignes.length > 0;

  for (const l of lignes) {
    const nom = el('div', { className: 'nom' }, `${l.type === 'dossier' ? '📁' : l.type === 'lien' ? '🔗' : '📄'} ${l.nom}`);
    if (etatUI.vue !== 'fichiers') nom.append(el('span', { className: 'chemin', textContent: `~/${l.dossier ?? ''}` }));
    if (l.unite) {
      const apercu = el('span', { className: 'apercu' });
      apercus.set(l.chemin, apercu);
      majApercu(l);
      nom.append(apercu);
    }
    if (l.protege) nom.append(el('span', { className: 'etiquette protege', textContent: '🔒 protégé' }));
    if (l.projet) nom.append(el('span', { className: 'etiquette', textContent: 'projet' }));
    if (etatUI.vue === 'supprimer') {
      nom.prepend(el('input', {
        type: 'checkbox',
        checked: etatUI.cochees.has(l.chemin),
        onclick: (ev) => ev.stopPropagation(),
        onchange: (ev) => {
          if (ev.target.checked) etatUI.cochees.add(l.chemin); else etatUI.cochees.delete(l.chemin);
          afficherBilan();
        },
      }));
    }
    const tr = el('tr', {},
      el('td', {}, nom),
      el('td', { textContent: libelleType(l) }),
      el('td', {}, l.protege ? el('span', { className: 'discret', textContent: '🔒' }) : l.unite ? etoiles(l.chemin) : el('span', { className: 'discret', textContent: '—', title: 'Simple conteneur : on note ses unités' })),
      el('td', { className: 'num taille' }, el('i', { style: `width:${(l.taille / max) * 100}%` }), el('b', { textContent: formatTaille(l.taille) })),
      el('td', { className: 'num', textContent: formatDate(l.modifie) }),
    );
    if (l === etatUI.selection) tr.classList.add('selection');
    tr.addEventListener('click', () => {
      corps.querySelector('.selection')?.classList.remove('selection');
      tr.classList.add('selection');
      etatUI.selection = l;
      afficherDetails(l);
    });
    tr.addEventListener('dblclick', () => ouvrir(l));
    corps.append(tr);
  }
}

// ---------- Suppression ----------
const cochees = () => etatUI.lignes.filter((l) => etatUI.cochees.has(l.chemin));

function afficherBilan() {
  if (etatUI.vue !== 'supprimer') return;
  const choix = cochees();
  const total = choix.reduce((somme, l) => somme + l.taille, 0);
  $('bilan').textContent = etatUI.lignes.length === 0
    ? 'Aucune unité notée à ce niveau. Note des unités avec les étoiles (onglet Unités).'
    : `${choix.length} / ${etatUI.lignes.length} sélectionnés — ${formatTaille(total)} à récupérer`;
  $('vider').disabled = choix.length === 0;
}

$('seuil').addEventListener('change', () => charger());

$('vider').addEventListener('click', async () => {
  const choix = cochees();
  const total = choix.reduce((somme, l) => somme + l.taille, 0);
  const apercu = choix.slice(0, 8).map((l) => `• ${l.chemin} (${formatTaille(l.taille)})`).join('\n');
  const suite = choix.length > 8 ? `\n… et ${choix.length - 8} autre(s)` : '';
  if (!confirm(`Mettre ${choix.length} élément(s) à la Corbeille (${formatTaille(total)}) ?\n\n${apercu}${suite}\n\nTu pourras les remettre depuis la Corbeille.`)) return;

  $('vider').disabled = true;
  $('bilan').textContent = 'Envoi à la Corbeille en cours…';
  const rep = await envoyer('/api/corbeille', 'POST', { chemins: choix.map((l) => l.chemin) });
  const { resultats, erreur } = await rep.json();
  await charger(); // recharge la liste (charger masque #resultat, on l'affiche après)

  const echecs = (resultats ?? []).filter((r) => !r.ok);
  const reussis = (resultats ?? []).length - echecs.length;
  $('resultat').textContent = erreur ? `Échec : ${erreur}`
    : `${reussis} élément(s) mis à la Corbeille.` + echecs.map((r) => `\n✗ ${r.chemin} : ${r.erreur}`).join('');
  $('resultat').hidden = false;
  majResume(); // met à jour le résumé global (taille, projets)
});

// Ouvre un dossier dans la vue Fichiers (pour un fichier : son dossier). Les dossiers « opaques »
// comme node_modules ne sont pas navigables.
function ouvrir(l) {
  const cible = l.type === 'dossier' ? l.chemin : (l.dossier ?? l.chemin.split('/').slice(0, -1).join('/'));
  if (l.type === 'dossier' && l.contenu === null) return;
  etatUI.vue = 'fichiers';
  document.querySelectorAll('#onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.vue === 'fichiers'));
  etatUI.chemin = cible.split('/').filter(Boolean);
  charger();
}

// ---------- Résumé automatique et mémo ----------
// Résumé calculé localement par le serveur (README, types de fichiers, dates, métadonnées macOS), puis ton mémo
function blocResume(l) {
  const bloc = el('div', { className: 'resume' });
  const phrase = el('p', { className: 'phrase', textContent: 'Résumé en cours…' });
  const complements = el('dl', { className: 'complements' });
  bloc.append(phrase, complements);

  const afficher = (r) => {
    phrase.textContent = r.phrase;
    complements.replaceChildren(...r.lignes.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  };
  const jeton = ++etatUI.jetonDetails;
  if (resumes.has(l.chemin)) afficher(resumes.get(l.chemin));
  else {
    fetch(`/api/resume?chemin=${encodeURIComponent(l.chemin)}`).then((r) => r.json()).then((r) => {
      if (r.erreur) throw new Error(r.erreur);
      resumes.set(l.chemin, r);
      if (jeton === etatUI.jetonDetails) afficher(r);
    }).catch((e) => { if (jeton === etatUI.jetonDetails) phrase.textContent = `Résumé indisponible : ${e.message}`; });
  }

  // Mémo : enregistré tout seul après une courte pause dans la frappe
  const zone = el('textarea', { className: 'memo-zone', rows: 3, maxLength: 2000, placeholder: 'Mon mémo : à quoi ça sert ?', value: etatUI.memos[l.chemin] ?? '' });
  const statut = el('span', { className: 'discret' });
  let delai;
  const enregistrer = async () => {
    const texte = zone.value.trim();
    const precedent = etatUI.memos[l.chemin] ?? '';
    if (texte === precedent) return;
    statut.textContent = 'Enregistrement…';
    const rep = await envoyer('/api/memos', 'PUT', { chemin: l.chemin, memo: texte }).catch(() => null);
    if (rep?.ok) {
      if (texte) etatUI.memos[l.chemin] = texte; else delete etatUI.memos[l.chemin];
      majApercu(l);
      statut.textContent = 'Enregistré ✓';
    } else {
      statut.textContent = 'Échec de l’enregistrement';
    }
  };
  zone.addEventListener('input', () => { statut.textContent = ''; clearTimeout(delai); delai = setTimeout(enregistrer, 800); });
  zone.addEventListener('blur', () => { clearTimeout(delai); enregistrer(); });
  bloc.append(zone, statut);
  return bloc;
}

// ---------- Panneau de détails ----------
function afficherDetails(l) {
  const panneau = $('details');
  panneau.replaceChildren();
  if (!l) {
    panneau.append(el('p', { className: 'discret', textContent: 'Clique sur une ligne pour voir ses informations.' }));
    return;
  }
  const dl = el('dl');
  const ligne = (k, v) => { if (v != null && v !== '') dl.append(el('dt', { textContent: k }), el('dd', { textContent: v })); };

  ligne('Type', libelleType(l));
  if (l.protege) ligne('Statut', '🔒 Protégé : jamais touché (contenu non listé, non notable, non supprimable)');
  else if (l.unite) dl.append(el('dt', { textContent: 'Note' }), el('dd', {}, etoiles(l.chemin)));
  else ligne('Note', 'Simple conteneur : on note ses unités, pas lui');
  if (l.unite) ligne('Unité', { projet: 'projet entier', dossier: 'dossier entier', fichier: 'fichier seul' }[l.unite]);
  ligne('Chemin', `~/${l.chemin}`);
  ligne('Taille', `${formatTaille(l.taille)} (${l.taille.toLocaleString('fr')} octets)`);
  ligne('Modifié', formatDate(l.modifie));
  ligne('Créé', l.cree ? formatDate(l.cree) : null);
  ligne('Dernier accès', l.acces ? formatDate(l.acces) : null);
  if (l.type === 'dossier') {
    ligne('Contenu', l.contenu === null ? (l.protege ? 'non listé (protégé)' : 'non listé (dépendances / dépôt git)') : `${l.contenu} élément(s)`);
  }

  if (l.projet) {
    const p = l.projet;
    dl.append(el('div', { className: 'sep' }));
    ligne('Projet', p.nom);
    ligne('Description', p.description);
    ligne('Technologies', p.technos.join(', '));
    ligne('Git', p.git ? 'oui' : 'non');
    ligne('Branche', p.branche);
    ligne('Dépôt distant', p.distant);
    ligne('Dernière activité', formatDate(p.activite));
    ligne('Récupérable', p.regenerable ? `${formatTaille(p.regenerable)} (dépendances, builds)` : null);
  }

  panneau.append(el('h2', { textContent: l.nom }));
  if (l.unite && !l.protege) panneau.append(blocResume(l));
  panneau.append(dl);
  if ((l.type === 'dossier' && l.contenu !== null) || l.type === 'fichier') {
    panneau.append(el('p', {}, el('button', { className: 'primaire', textContent: l.type === 'fichier' ? 'Voir son dossier' : 'Ouvrir le dossier', onclick: () => ouvrir(l) })));
  }
}

// ---------- Événements ----------
$('tri').addEventListener('change', () => (etatUI.vue === 'fichiers' ? afficherListe() : charger()));
$('genre').addEventListener('change', () => charger());
$('statut').addEventListener('change', () => charger());
$('suite').addEventListener('click', () => charger(true));
let delai;
$('dans').addEventListener('input', () => { clearTimeout(delai); delai = setTimeout(() => charger(), 300); });
document.querySelectorAll('#onglets button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#onglets button').forEach((x) => x.classList.toggle('actif', x === b));
  etatUI.vue = b.dataset.vue;
  charger();
}));

suivreScan(); // si un scan existe déjà côté serveur, on l'affiche directement
