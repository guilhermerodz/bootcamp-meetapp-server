import { Op } from 'sequelize';
import { startOfHour, addHours, format } from 'date-fns';
import pt from 'date-fns/locale/pt';

import Mail from '../../lib/Mail';

import Meetup from '../models/Meetup';
import User from '../models/User';
import File from '../models/File';

class SubscribedController {
  async index(req, res) {
    const meetups = await Meetup.findAll({
      where: {
        subscribers: { [Op.contains]: [req.userId] }
      },
      attributes: ['id', 'title', 'description', 'location', 'date'],
      order: ['date'],
      include: [
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar',
              attributes: ['id', 'path', 'url']
            }
          ]
        },
        {
          model: File,
          as: 'banner',
          attributes: ['id', 'path', 'url']
        }
      ]
    });

    return res.json(meetups.filter(m => !m.past));
  }

  async store(req, res) {
    const meetup = await Meetup.findOne({
      where: { id: req.params.id },
      include: [
        {
          model: File,
          as: 'banner',
          attributes: ['id', 'path', 'url']
        },
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'name', 'email']
        }
      ]
    });

    if (!meetup)
      return res.status(400).json({ error: 'Meetup does not exists' });

    if (meetup.past)
      return res.status(400).json({ error: 'Meetup is already finished' });

    if (req.userId === meetup.owner_id)
      return res
        .status(400)
        .json({ error: "The meetup owner can't subscribe" });

    if (meetup.subscribers.includes(req.userId))
      return res.status(400).json({ error: 'Already subscribed' });

    /**
     * Check for meetups at the same time
     */
    const hourStart = startOfHour(Number(meetup.date));
    const minimumMeetupHours = 2;

    const conflictMeetups = await Meetup.findOne({
      where: {
        subscribers: { [Op.contains]: [req.userId] },
        date: {
          [Op.between]: [hourStart, addHours(hourStart, minimumMeetupHours)]
        }
      },
      attributes: ['id', 'title', 'location', 'date']
    });

    if (conflictMeetups)
      return res.status(400).json({
        error: 'You are already subscribed to a meetup at the same time',
        conflict: conflictMeetups
      });

    const { title, description, location, date, banner } = await meetup.update({
      subscribers: [req.userId, ...meetup.subscribers]
    });

    const { avatar, name: subName, email: subEmail } = await User.findOne({
      where: { id: req.userId },
      include: [
        {
          model: File,
          as: 'avatar',
          attributes: ['id', 'path', 'url']
        }
      ]
    });

    const formatDate = d =>
      format(d, "'dia' dd 'de' MMMM 'de' yyyy', às' H:mm'h'", { locale: pt });

    await Mail.sendMail({
      to: `${meetup.owner.name} <${meetup.owner.email}>`,
      subject: `Nova inscrição no seu Meetup - ${meetup.title}`,
      template: 'new-subscriber',
      context: {
        ownerName: meetup.owner.name,
        bannerURL: banner ? banner.url : null,
        meetupTitle: title,
        meetupDate: formatDate(meetup.date),
        subAvatar: avatar ? avatar.url : null,
        subName,
        subEmail,
        subDate: formatDate(new Date()),
        subCount: meetup.subscribers.length
      }
    });

    return res.json({
      title,
      description,
      location,
      date,
      banner
    });
  }

  async delete(req, res) {
    const meetup = await Meetup.findOne({ where: { id: req.params.id } });

    if (!meetup)
      return res.status(400).json({ error: 'Meetup does not exists' });

    if (meetup.past)
      return res.status(400).json({ error: 'Meetup is already finished' });

    if (!meetup.subscribers.includes(req.userId))
      return res.status(400).json({ error: 'You are not subscribed' });

    const removeFromSubs = subs => {
      subs.splice(subs.indexOf(req.userId), 1);
      return subs;
    };
    const subscribers = removeFromSubs(meetup.subscribers);

    await meetup.update({ subscribers });

    return res.send();
  }
}

export default new SubscribedController();
