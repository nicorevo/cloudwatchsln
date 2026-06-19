#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { getSsoSessionExpiry } = require('../src/aws-auth-manager');

async function resolveProfile() {
    if (process.argv[2]) {
        return process.argv[2];
    }

    const configEnv = process.env.CONFIG_ENV || 'prod';
    const configPath = path.join(__dirname, '..', `config.${configEnv}.json`);

    if (await fs.pathExists(configPath)) {
        const config = await fs.readJson(configPath);
        if (config.aws?.profile) {
            return config.aws.profile;
        }
    }

    return null;
}

function formatDuration(minutes) {
    if (minutes <= 0) {
        return 'scaduta';
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);

    if (hours === 0) {
        return `${remainingMinutes} minuti`;
    }

    return `${hours} h ${remainingMinutes} min`;
}

async function main() {
    const profile = await resolveProfile();
    const expiry = await getSsoSessionExpiry(profile);

    console.log(`Profilo AWS: ${profile}`);

    if (!expiry) {
        console.log('Sessione SSO: non trovata in cache (esegui aws sso login)');
        process.exitCode = 1;
        return;
    }

    const minutesRemaining = (expiry.getTime() - Date.now()) / 60000;
    console.log(`Sessione SSO scade: ${expiry.toISOString()}`);
    console.log(`Tempo rimanente: ${formatDuration(minutesRemaining)}`);

    if (minutesRemaining <= 0) {
        console.log(`Azione: aws sso login --profile ${profile}`);
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('Errore check sessione SSO:', error.message);
    process.exit(1);
});
