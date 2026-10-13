const $ = (id) => document.getElementById(id);

const etatUI = {
  vue: 'fichiers', // fichiers | projets
  chemin: [], // segments du dossier courant
  lignes: [],
  selection: null,
  notes: {}, // chemin relatif -> 1..5
  cochees: new Set(), // vue « à supprimer » : chemins qui partiront à la Corbeille
};
// Requêtes qui modifient quelque chose : l'en-tête prouve qu'elles viennent de cette page
const envoyer = (url, methode, corps) => fetch(url, {
  method: methode,
  headers: { 'X-Nettoyeur': '1' },
  body: corps ? JSON.stringify(corps) : undefined,
});

const notesChargees = fetch('/api/notes').then((r) => r.json()).then((n) => { etatUI.notes = n; });

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
    : `${e.fichiers.toLocaleString('fr')} fichiers, ${e.dossiers.toLocaleString('fr')} dossiers, ${e.projets} projets, ${formatTaille(e.taille)}` +
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
async function charger() {
  etatUI.selection = null;
  afficherDetails(null);
  $('option-imbriques').hidden = etatUI.vue !== 'projets';
  $('suppression').hidden = etatUI.vue !== 'supprimer';
  $('option-tri').hidden = etatUI.vue === 'supprimer'; // cette liste est triée par note
  $('resultat').hidden = true;
  await notesChargees;

  if (etatUI.vue === 'supprimer') {
    const d = await (await fetch(`/api/a-supprimer?seuil=${$('seuil').value}`)).json();
    etatUI.lignes = d.elements;
    etatUI.cochees = new Set(d.elements.map((e) => e.chemin)); // tout est coché, à toi de décocher
  } else if (etatUI.vue === 'fichiers') {
    const rel = etatUI.chemin.join('/');
    const d = await (await fetch(`/api/dossier?chemin=${encodeURIComponent(rel)}`)).json();
    etatUI.lignes = (d.enfants ?? []).map((e) => ({ ...e, chemin: [...etatUI.chemin, e.nom].join('/') }));
  } else {
    const projets = await (await fetch('/api/projets')).json();
    etatUI.lignes = projets
      .filter((p) => $('imbriques').checked || !p.parent)
      .map((p) => ({
        nom: p.nom || p.chemin.split('/').pop(), chemin: p.chemin, type: 'dossier', taille: p.taille,
        modifie: p.activite, contenu: 1, projet: p, vueProjet: true,
      }));
  }
  afficherFil();
  afficherListe();
  afficherBilan();
}

// ---------- Fil d'Ariane ----------
function afficherFil() {
  const fil = $('fil');
  fil.replaceChildren();
  if (etatUI.vue !== 'fichiers') {
    fil.append(el('span', { textContent: `${etatUI.lignes.length} ${etatUI.vue === 'projets' ? 'projets' : 'éléments'}` }));
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
  if (etatUI.vue === 'supprimer') return lignes; // déjà triée : les moins bien notés d'abord
  const cle = $('tri').value;
  const copie = [...lignes];
  if (cle === 'nom') return copie.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (cle === 'note') return copie.sort((a, b) => (etatUI.notes[b.chemin] ?? 0) - (etatUI.notes[a.chemin] ?? 0) || b.taille - a.taille);
  if (cle === 'type') return copie.sort((a, b) => libelleType(a).localeCompare(libelleType(b), 'fr') || b.taille - a.taille);
  return copie.sort((a, b) => (b[cle] ?? 0) - (a[cle] ?? 0));
}

function afficherListe() {
  const lignes = trier(etatUI.lignes);
  const max = Math.max(1, ...lignes.map((l) => l.taille));
  const corps = $('liste');
  corps.replaceChildren();
  $('vide').hidden = lignes.length > 0;

  for (const l of lignes) {
    const nom = el('div', { className: 'nom' }, `${l.type === 'dossier' ? '📁' : l.type === 'lien' ? '🔗' : '📄'} ${l.nom}`);
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
      el('td', {}, l.protege ? el('span', { className: 'discret', textContent: '🔒' }) : etoiles(l.chemin)),
      el('td', { className: 'num taille' }, el('i', { style: `width:${(l.taille / max) * 100}%` }), el('b', { textContent: formatTaille(l.taille) })),
      el('td', { className: 'num', textContent: formatDate(l.modifie) }),
    );
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
    ? 'Aucun élément noté à ce niveau. Note des fichiers ou projets avec les étoiles.'
    : `${choix.length} / ${etatUI.lignes.length} sélectionnés — ${formatTaille(total)} à récupérer`;
  $('vider').disabled = choix.length === 0;
}

$('seuil').addEventListener('change', charger);

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

// Ouvre un dossier navigable (les dossiers « opaques » comme node_modules ne le sont pas)
function ouvrir(l) {
  if (l.type !== 'dossier' || l.contenu === null) return;
  etatUI.vue = 'fichiers';
  document.querySelectorAll('#onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.vue === 'fichiers'));
  etatUI.chemin = l.chemin.split('/').filter(Boolean);
  charger();
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
  else dl.append(el('dt', { textContent: 'Note' }), el('dd', {}, etoiles(l.chemin)));
  ligne('Chemin', `~/${l.chemin}`);
  ligne('Taille', `${formatTaille(l.taille)} (${l.taille.toLocaleString('fr')} octets)`);
  if (!l.vueProjet) ligne('Modifié', formatDate(l.modifie)); // pour un projet, l'activité est dans son bloc
  ligne('Créé', l.cree ? formatDate(l.cree) : null);
  ligne('Dernier accès', l.acces ? formatDate(l.acces) : null);
  if (l.type === 'dossier' && !l.vueProjet) {
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

  panneau.append(el('h2', { textContent: l.nom }), dl);
  if (l.type === 'dossier' && l.contenu !== null) {
    panneau.append(el('p', {}, el('button', { className: 'primaire', textContent: 'Ouvrir le dossier', onclick: () => ouvrir(l) })));
  }
}

// ---------- Événements ----------
$('tri').addEventListener('change', afficherListe);
$('imbriques').addEventListener('change', charger);
document.querySelectorAll('#onglets button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#onglets button').forEach((x) => x.classList.toggle('actif', x === b));
  etatUI.vue = b.dataset.vue;
  charger();
}));

suivreScan(); // si un scan existe déjà côté serveur, on l'affiche directement
