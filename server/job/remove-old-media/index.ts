import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { LessThan } from 'typeorm';

class RemoveOldMedia {
  private running: boolean;

  async run() {
    this.running = true;
    const media = await getRepository(Media).findBy({
      lastSeasonChange: LessThan(
        new Date(new Date().getTime() - getSettings().removeOldMediaSpan)
      ),
    });
    for (const { id } of media) {
      await this.removeFile(id);
      await this.remove(id);
    }
    this.running = false;
  }

  private async remove(id: number) {
    try {
      const mediaRepository = getRepository(Media);

      const media = await mediaRepository.findOneOrFail({
        where: { id },
      });

      await mediaRepository.remove(media);
    } catch (e) {
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        message: e.message,
      });
      throw e;
    }
  }

  private async removeFile(id: number) {
    try {
      const settings = getSettings();
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOneOrFail({
        where: { id },
      });
      const is4k = media.serviceUrl4k !== undefined;
      const isMovie = media.mediaType === MediaType.MOVIE;
      let serviceSettings;
      if (isMovie) {
        serviceSettings = settings.radarr.find(
          (radarr) => radarr.isDefault && radarr.is4k === is4k
        );
      } else {
        serviceSettings = settings.sonarr.find(
          (sonarr) => sonarr.isDefault && sonarr.is4k === is4k
        );
      }

      if (
        media.serviceId &&
        media.serviceId >= 0 &&
        serviceSettings?.id !== media.serviceId
      ) {
        if (isMovie) {
          serviceSettings = settings.radarr.find(
            (radarr) => radarr.id === media.serviceId
          );
        } else {
          serviceSettings = settings.sonarr.find(
            (sonarr) => sonarr.id === media.serviceId
          );
        }
      }
      if (!serviceSettings) {
        logger.warn(
          `There is no default ${
            is4k ? '4K ' : '' + isMovie ? 'Radarr' : 'Sonarr'
          }/ server configured. Did you set any of your ${
            is4k ? '4K ' : '' + isMovie ? 'Radarr' : 'Sonarr'
          } servers as default?`,
          {
            label: 'Media Request',
            mediaId: media.id,
          }
        );
        return;
      }
      let service;
      if (isMovie) {
        service = new RadarrAPI({
          apiKey: serviceSettings?.apiKey,
          url: RadarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
      } else {
        service = new SonarrAPI({
          apiKey: serviceSettings?.apiKey,
          url: SonarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
      }

      if (isMovie) {
        await (service as RadarrAPI).removeMovie(
          parseInt(
            is4k
              ? (media.externalServiceSlug4k as string)
              : (media.externalServiceSlug as string)
          )
        );
      } else {
        const tmdb = new TheMovieDb();
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
        if (!tvdbId) {
          throw new Error('TVDB ID not found');
        }
        await (service as SonarrAPI).removeSerie(tvdbId);
      }
    } catch (e) {
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        message: e.message,
      });
      throw e;
    }
  }

  status() {
    return {
      running: this.running,
    };
  }
}

export const removeOldMedia = new RemoveOldMedia();
